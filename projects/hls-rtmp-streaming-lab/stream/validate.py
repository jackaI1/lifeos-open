"""Validate this lab's unencrypted, relative-URI HLS event playlists and media."""
import argparse
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import urlopen


class ValidationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def attributes(line):
    """Split an HLS attribute list, retaining commas inside quoted values."""
    return dict((k, v.strip('"')) for k, v in re.findall(r'([A-Z0-9-]+)=("[^"]*"|[^,]+)', line.split(':', 1)[1]))


class Source:
    def __init__(self, master):
        self.remote = urlsplit(master).scheme in ('http', 'https')
        self.master = master if self.remote else str(Path(master).resolve())
        self.root = self.master.rsplit('/', 1)[0] + '/' if self.remote else Path(self.master).parent

    def child(self, parent, uri):
        parsed = urlsplit(uri)
        decoded = unquote(parsed.path)
        require(not parsed.scheme and not parsed.netloc and not parsed.query and not parsed.fragment
                and decoded and not decoded.startswith('/') and '\\' not in decoded
                and '..' not in decoded.split('/'), f'Unsafe relative URI: {uri}')
        if self.remote:
            result = urljoin(parent, uri)
            require(result.startswith(self.root), f'URI escapes stream directory: {uri}')
            return result
        result = (Path(parent).parent / decoded).resolve()
        require(self.root in result.parents, f'URI escapes stream directory: {uri}')
        return str(result)

    def read(self, location):
        try:
            if self.remote:
                # Redirects must stay inside the published stream directory too.
                with urlopen(location, timeout=8) as response:
                    require(response.geturl().startswith(self.root), 'Redirect escapes stream directory')
                    content = response.read(16 * 1024 * 1024 + 1)
            else:
                with open(location, 'rb') as file:
                    content = file.read(16 * 1024 * 1024 + 1)
            require(0 < len(content) <= 16 * 1024 * 1024, f'Empty or oversized resource: {location}')
            return content
        except (OSError, ValueError) as error:
            raise ValidationError(f'Cannot read {location}: {error}') from error

    def lines(self, location):
        try:
            lines = [line.strip() for line in self.read(location).decode('utf-8-sig').splitlines() if line.strip()]
        except UnicodeError as error:
            raise ValidationError(f'Not UTF-8: {location}') from error
        require(lines and lines[0] == '#EXTM3U', f'Missing EXTM3U header: {location}')
        return lines


def media_playlist(source, location, live):
    lines = source.lines(location)
    require(live or '#EXT-X-ENDLIST' in lines, f'Unfinished playlist: {location}')
    target = next((float(x.split(':')[1]) for x in lines if x.startswith('#EXT-X-TARGETDURATION:')), 0)
    sequence = next((int(x.split(':')[1]) for x in lines if x.startswith('#EXT-X-MEDIA-SEQUENCE:')), 0)
    require(math.isfinite(target) and target > 0 and target.is_integer(), 'Invalid target duration')
    require(sequence >= 0, 'Invalid media sequence')
    segments, pending = [], None
    for line in lines[1:]:
        if line.startswith('#EXTINF:'):
            require(pending is None, 'EXTINF without segment URI')
            pending = float(line.split(':', 1)[1].split(',')[0])
            require(math.isfinite(pending) and 0 < pending <= target + 0.05, f'Invalid segment duration: {pending}')
        elif not line.startswith('#'):
            require(pending is not None, 'Segment URI without EXTINF')
            segments.append((source.child(location, line), pending))
            pending = None
        elif line.startswith(('#EXT-X-KEY:', '#EXT-X-MAP:', '#EXT-X-DISCONTINUITY', '#EXT-X-BYTERANGE:')):
            raise ValidationError('Encrypted, discontinuous, init-map and byte-range streams are outside this validator')
    require(pending is None and segments, f'Incomplete or empty playlist: {location}')
    return sequence, segments


def timestamp(value):
    require(re.fullmatch(r'(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}', value), f'Invalid WebVTT timestamp: {value}')
    parts = value.split(':')
    require(float(parts[-1]) < 60 and int(parts[-2]) < 60, 'Invalid WebVTT clock')
    result = 0.0
    for part in parts:
        result = result * 60 + float(part)
    return result


def caption_cues(content, start, duration):
    text = content.decode('utf-8-sig')
    require(text.startswith('WEBVTT\n') or text.startswith('WEBVTT\r\n'), 'Missing WEBVTT header')
    cues = 0
    for block in re.split(r'\r?\n\s*\r?\n', text):
        lines = block.splitlines()
        timing = next((i for i, line in enumerate(lines) if '-->' in line), None)
        if timing is None:
            continue
        left, right = lines[timing].split('-->', 1)
        cue_start, cue_end = timestamp(left.strip()), timestamp(right.strip().split()[0])
        require(cue_start < cue_end, 'Caption ends before it starts')
        require(cue_start < start + duration + 0.1 and cue_end > start - 0.1, 'Caption outside its segment timeline')
        require(any(x.strip() for x in lines[timing + 1:]), 'Caption cue has no text')
        cues += 1
    return cues


def probe_segment(content, resolution, declared_duration):
    with tempfile.NamedTemporaryFile(suffix='.ts') as file:
        file.write(content)
        file.flush()
        command = ['ffprobe', '-v', 'error', '-show_streams', '-show_packets', '-of', 'json', file.name]
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
    require(result.returncode == 0, 'ffprobe could not decode segment metadata')
    data = json.loads(result.stdout)
    video = next((s for s in data['streams'] if s['codec_type'] == 'video'), {})
    audio = next((s for s in data['streams'] if s['codec_type'] == 'audio'), {})
    require(video.get('codec_name') == 'h264' and audio.get('codec_name') == 'aac', 'Expected H.264 video and AAC audio')
    require(f"{video.get('width')}x{video.get('height')}" == resolution, 'Media resolution does not match master')
    packets = [p for p in data['packets'] if p['stream_index'] == video['index']]
    require(packets and 'K' in packets[0].get('flags', ''), 'Segment does not begin with a keyframe')
    start = float(packets[0]['pts_time'])
    end = max(float(p['pts_time']) + float(p.get('duration_time', 0)) for p in packets)
    require(abs(end - start - declared_duration) <= 0.12, 'Actual media duration does not match EXTINF')
    return start


def validate(master, probe=False, live=False, min_duration=10):
    source = Source(master)
    lines = source.lines(source.master)
    variants, subtitles, pending = [], {}, None
    for line in lines[1:]:
        if line.startswith('#EXT-X-MEDIA:'):
            attrs = attributes(line)
            if attrs.get('TYPE') == 'SUBTITLES':
                require(all(attrs.get(k) for k in ('GROUP-ID', 'NAME', 'LANGUAGE', 'URI')), 'Incomplete subtitle declaration')
                subtitles[attrs['GROUP-ID']] = source.child(source.master, attrs['URI'])
        elif line.startswith('#EXT-X-STREAM-INF:'):
            require(pending is None, 'Variant without URI')
            pending = attributes(line)
        elif not line.startswith('#'):
            require(pending is not None, 'Unexpected master URI')
            variants.append((pending, source.child(source.master, line)))
            pending = None
    require(pending is None and len(variants) == 3, 'Expected exactly three renditions')
    require(len({x[1] for x in variants}) == 3, 'Duplicate rendition URI')
    require(len({int(x[0]['BANDWIDTH']) for x in variants}) == 3
            and all(int(x[0]['BANDWIDTH']) > 0 for x in variants), 'Expected three distinct positive bitrates')
    require(len({x[0].get('RESOLUTION') for x in variants}) == 3, 'Expected three distinct resolutions')
    reference, starts, video_count = None, None, 0
    for attrs, location in variants:
        require(attrs.get('SUBTITLES') in subtitles, 'Rendition is missing its subtitle group')
        require(re.fullmatch(r'\d+x\d+', attrs.get('RESOLUTION', '')), 'Invalid resolution')
        require('avc1.' in attrs.get('CODECS', '') and 'mp4a.40.2' in attrs.get('CODECS', ''), 'Missing codec declaration')
        sequence, segments = media_playlist(source, location, live)
        durations = [duration for _, duration in segments]
        if reference is None:
            reference = (sequence, durations)
        else:
            # During live validation, atomic playlist updates may be one segment apart.
            common = min(len(reference[1]), len(durations))
            require(sequence == reference[0] and (abs(len(durations) - len(reference[1])) <= 1 if live else len(durations) == len(reference[1]))
                    and all(abs(a - b) < 0.05 for a, b in zip(reference[1][:common], durations[:common])), 'Renditions are not aligned')
        current_starts = []
        for uri, duration in segments:
            content = source.read(uri)
            if probe:
                current_starts.append(probe_segment(content, attrs['RESOLUTION'], duration))
            video_count += 1
        if probe:
            require(abs(current_starts[0]) < 0.1, 'Media clock must begin at zero for WebVTT alignment')
            require(all(abs(b - a - d) < 0.08 for a, b, d in zip(current_starts, current_starts[1:], durations)), 'Media timestamps have a gap or overlap')
            if starts is not None:
                require(all(abs(a - b) < 0.05 for a, b in zip(starts, current_starts)), 'Rendition media clocks differ')
            starts = current_starts
    total = sum(reference[1])
    require(total >= min_duration, f'Stream too short: {total:.3f}s < {min_duration}s')
    cues, caption_segments = 0, 0
    for location in subtitles.values():
        sequence, segments = media_playlist(source, location, live)
        require(sequence == reference[0], 'Caption sequence does not match video')
        require((abs(len(segments) - len(reference[1])) <= 1 if live else len(segments) == len(reference[1]))
                and all(abs(d - r) < 0.05 for (_, d), r in zip(segments, reference[1])), 'Caption playlist is not aligned with video')
        clock = 0
        track_cues = 0
        for uri, duration in segments:
            track_cues += caption_cues(source.read(uri), clock, duration)
            clock += duration
            caption_segments += 1
        require(track_cues > 0, 'Caption track has no cues')
        cues += track_cues
    return dict(renditions=len(variants), video_segments=video_count, caption_segments=caption_segments,
                caption_cues=cues, duration_seconds=round(total, 3), media_probed=probe)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('master')
    parser.add_argument('--probe', action='store_true', help='Check real segment codecs, resolution, keyframes and timestamps with ffprobe')
    parser.add_argument('--live', action='store_true', help='Allow playlists without ENDLIST and asynchronous updates')
    parser.add_argument('--min-duration', type=float, default=10)
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.master, args.probe, args.live, args.min_duration), indent=2))
    except (ValidationError, KeyError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f'Validation failed: {error}\n')


if __name__ == '__main__':
    main()

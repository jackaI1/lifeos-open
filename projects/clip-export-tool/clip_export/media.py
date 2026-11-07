"""FFmpeg rendering with bounded diagnostics and temporary output ownership."""
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional

from .captions import clip_captions, read_srt, write_srt
from .edits import Edit

FORMATS = {'vertical': (1080, 1920), 'square': (1080, 1080), 'widescreen': (1920, 1080)}
LOUDNESS = 'I=-16:TP=-1.5:LRA=11'
AUDIO = 'aformat=sample_rates=48000:channel_layouts=stereo'


def executable(name: str) -> str:
    configured = os.environ.get(name.upper(), name)
    found = shutil.which(configured)
    if not found:
        raise ValueError(f'{configured} is missing. Install FFmpeg and ffprobe; see README setup.')
    return found


def run_ffmpeg(args: List[str], cwd: Optional[Path] = None, info: bool = False) -> str:
    # A file keeps long FFmpeg diagnostics out of memory. Only its final 32 KiB is retained.
    with tempfile.TemporaryFile() as log:
        command = [executable('ffmpeg'), '-hide_banner', '-nostdin', '-loglevel', 'info' if info else 'error',
                   '-y', '-threads', '2', '-filter_threads', '1', *map(str, args)]
        result = subprocess.run(command, cwd=cwd, stdout=subprocess.DEVNULL, stderr=log, timeout=1800)
        log.seek(0, 2)
        log.seek(max(0, log.tell() - 32768))
        tail = log.read().decode('utf-8', errors='replace')
        if result.returncode:
            raise ValueError('FFmpeg could not process this media:\n' + tail[-4000:])
        return tail


def probe(path: Path) -> dict:
    result = subprocess.run([executable('ffprobe'), '-v', 'error', '-show_streams', '-show_format',
                             '-of', 'json', str(Path(path).resolve())], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise ValueError('Cannot read media: ' + result.stderr[-2000:])
    return json.loads(result.stdout)



def packet_endpoint(source: Path) -> float:
    # Some containers expose neither stream duration nor a DURATION tag. Scan only
    # video packet timestamps into a temporary file, never a large in-memory list.
    with tempfile.TemporaryFile(mode='w+') as packets, tempfile.TemporaryFile() as errors:
        result = subprocess.run([executable('ffprobe'), '-v', 'error', '-select_streams', 'v:0',
                                 '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', str(source)],
                                stdout=packets, stderr=errors, timeout=60)
        if result.returncode:
            raise ValueError('Cannot determine the source video duration')
        packets.seek(0)
        endpoint = 0.0
        for line in packets:
            fields = line.strip().split(',')
            try:
                pts = float(fields[0])
                length = float(fields[1]) if len(fields) > 1 and fields[1] != 'N/A' else 0
                if math.isfinite(pts) and math.isfinite(length):
                    endpoint = max(endpoint, pts + length)
            except (ValueError, IndexError):
                continue
        return endpoint


def validate_source(source: Path, edits: List[Edit]) -> dict:
    data = probe(source)
    video = next((s for s in data['streams'] if s['codec_type'] == 'video'), None)
    if video is None:
        raise ValueError('Source has no video stream')
    origin = float(data['format'].get('start_time', 0))
    video_start = max(0, float(video.get('start_time', origin)) - origin)
    if video.get('duration') not in (None, 'N/A'):
        duration = video_start + float(video['duration'])
    elif video.get('tags', {}).get('DURATION'):
        hours, minutes, seconds = video['tags']['DURATION'].split(':')
        duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds) - origin
    else:
        duration = packet_endpoint(source) - origin
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Source needs a known, positive video duration')
    if not edits or len({e.name for e in edits}) != len(edits):
        raise ValueError('Provide edits with unique names')
    for edit in edits:
        if edit.start + .05 < video_start:
            raise ValueError(f'{edit.name} starts before the first video frame at {video_start:.3f}s')
        if edit.end > duration + .001:
            raise ValueError(f'{edit.name} ends at {edit.end}s, beyond the {duration:.3f}s video')
    return data


def require_subtitles() -> None:
    result = subprocess.run([executable('ffmpeg'), '-hide_banner', '-filters'], capture_output=True, text=True, timeout=30)
    if ' subtitles ' not in result.stdout:
        raise ValueError('FFmpeg needs the subtitles filter (libass). On macOS: brew install ffmpeg-full; '
                         'export FFMPEG="$(brew --prefix ffmpeg-full)/bin/ffmpeg"')


def audio_filter(source: Path, edit: Edit) -> str:
    duration = edit.end - edit.start
    base = AUDIO + f',aresample=async=1:first_pts=0,apad=whole_dur={duration},atrim=duration={duration}'
    log = run_ffmpeg(['-ss', str(edit.start), '-i', str(source), '-t', str(edit.end - edit.start),
                     '-map', '0:a:0', '-af', base + ',loudnorm=' + LOUDNESS + ':print_format=json',
                     '-vn', '-f', 'null', '-'], info=True)
    stats, _ = json.JSONDecoder().raw_decode(log[log.rfind('{'):])
    keys = {'measured_I': 'input_i', 'measured_TP': 'input_tp', 'measured_LRA': 'input_lra',
            'measured_thresh': 'input_thresh', 'offset': 'target_offset'}
    if not all(math.isfinite(float(stats[key])) for key in keys.values()):
        # Silence cannot have a finite integrated loudness; preserve it without adding noise.
        return base
    measured = ':'.join(f'{key}={stats[value]}' for key, value in keys.items())
    return base + ',loudnorm=' + LOUDNESS + ':' + measured + ':linear=true'


def render(source: Path, edit: Edit, target: Path, shape: str, fit: str, cues, data: dict, work: Path) -> None:
    width, height = FORMATS[shape]
    # First convert anamorphic pixels to square pixels; then fit without stretching.
    vf = 'scale=trunc(iw*sar/2)*2:ih,setsar=1,'
    vf += f'scale={width}:{height}:force_original_aspect_ratio={"decrease" if fit == "pad" else "increase"}:force_divisible_by=2,'
    vf += (f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black' if fit == 'pad'
           else f'crop={width}:{height}:(iw-ow)/2:(ih-oh)/2')
    vf += ',setsar=1,fps=30'
    selected = clip_captions(cues, edit.start, edit.end)
    if selected:
        write_srt(work / 'captions.srt', selected)
        vf += ",subtitles=filename=captions.srt:force_style='FontName=DejaVu Sans,FontSize=18,Outline=1,MarginV=24'"
    has_audio = any(s['codec_type'] == 'audio' for s in data['streams'])
    args = ['-ss', str(edit.start), '-i', str(source)]
    if not has_audio:
        args += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    args += ['-t', str(edit.end - edit.start), '-map', '0:v:0', '-map', '0:a:0' if has_audio else '1:a:0',
             '-vf', vf, '-af', audio_filter(source, edit) if has_audio else AUDIO,
             '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-threads', '2', '-pix_fmt', 'yuv420p',
             '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-map_metadata', '-1',
             '-movflags', '+faststart', str(target)]
    run_ffmpeg(args, cwd=work)


def export_clips(source: Path, edits: List[Edit], output: Path, captions: Optional[Path] = None,
                 formats: Optional[List[str]] = None, fit: str = 'pad') -> List[Path]:
    source, output = Path(source).resolve(), Path(output).resolve()
    formats = list(FORMATS) if formats is None else formats
    if not formats or len(set(formats)) != len(formats) or any(f not in FORMATS for f in formats):
        raise ValueError('Choose distinct formats from vertical, square, widescreen')
    if fit not in ('pad', 'crop'):
        raise ValueError('Fit must be pad or crop')
    data = validate_source(source, edits)
    cues = read_srt(captions) if captions else []
    if cues:
        require_subtitles()
    targets = [output / f'{e.name}-{shape}.mp4' for e in edits for shape in formats]
    for target in targets:
        if target.exists():
            raise FileExistsError(f'Output already exists: {target}. Choose a new output directory.')
    output.mkdir(parents=True, exist_ok=True)
    published = []
    try:
        with tempfile.TemporaryDirectory(prefix='.clip-export-', dir=output) as tmp:
            work = Path(tmp)
            for edit in edits:
                for shape in formats:
                    staged = work / f'{edit.name}-{shape}.mp4'
                    render(source, edit, staged, shape, fit, cues, data, work)
                    encoded = probe(staged)
                    picture = next((stream for stream in encoded['streams'] if stream['codec_type'] == 'video'), None)
                    if picture is None or abs(float(picture.get('duration', 0)) - (edit.end - edit.start)) > .1:
                        raise ValueError(f'{edit.name} did not produce the requested video duration')
            for target in targets:
                # Exclusive publication: even a concurrent export cannot overwrite an existing file.
                os.link(work / target.name, target)
                published.append(target)
    except BaseException:
        for target in published:
            target.unlink()
        raise
    return targets

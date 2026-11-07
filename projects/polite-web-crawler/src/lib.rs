use futures::{stream::FuturesUnordered, StreamExt};
use reqwest::{Client, StatusCode};
use scraper::{Html, Selector};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use url::Url;

const AGENT: &str = "JackPoliteCrawler";
const MAX_BODY: usize = 2_000_000;

#[derive(Clone)]
pub struct Config {
    pub concurrency: usize,
    pub delay: Duration,
    pub max_pages: usize,
    pub retries: usize,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            concurrency: 8,
            delay: Duration::from_millis(500),
            max_pages: 100,
            retries: 2,
        }
    }
}
#[derive(Serialize, Debug)]
pub struct Page {
    pub url: String,
    pub status: u16,
    pub sha256: String,
    pub file: String,
}
#[derive(Serialize, Debug)]
pub struct Report {
    pub pages: Vec<Page>,
    pub elapsed_seconds: f64,
    pub pages_per_second: f64,
    pub duplicate_urls: usize,
    pub duplicate_contents: usize,
    pub duplicate_rate: f64,
    pub blocked: usize,
    pub errors: usize,
}
#[derive(Default)]
struct Host {
    robots: Option<Robots>,
    last: Option<Instant>,
}
#[derive(Default)]
struct Robots {
    rules: Vec<(bool, String)>,
    delay: Option<Duration>,
}
impl Robots {
    fn parse(text: &str) -> Self {
        let mut groups: Vec<(Vec<String>, Vec<(bool, String)>, Option<Duration>)> = Vec::new();
        let mut agents = Vec::new();
        let mut rules = Vec::new();
        let mut delay = None;
        let mut directives = false;
        for line in text.lines() {
            let line = line.split('#').next().unwrap_or("");
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let value = value.trim();
            match key.trim().to_ascii_lowercase().as_str() {
                "user-agent" => {
                    if directives {
                        groups.push((
                            std::mem::take(&mut agents),
                            std::mem::take(&mut rules),
                            delay.take(),
                        ));
                        directives = false;
                    }
                    agents.push(value.to_ascii_lowercase());
                }
                "allow" | "disallow" if !agents.is_empty() => {
                    directives = true;
                    if !value.is_empty() {
                        rules.push((key.trim().eq_ignore_ascii_case("allow"), value.to_string()));
                    }
                }
                "crawl-delay" if !agents.is_empty() => {
                    directives = true;
                    delay = value
                        .parse::<f64>()
                        .ok()
                        .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 3600.0)
                        .map(Duration::from_secs_f64);
                }
                _ => (),
            }
        }
        if !agents.is_empty() {
            groups.push((agents, rules, delay));
        }
        let best = groups
            .iter()
            .flat_map(|g| &g.0)
            .filter(|a| *a == "*" || AGENT.to_ascii_lowercase().contains(a.as_str()))
            .map(|a| if a == "*" { 0 } else { a.len() })
            .max();
        let mut result = Robots::default();
        for (agents, rules, delay) in groups {
            if agents.iter().any(|a| {
                Some(if a == "*" {
                    0
                } else if AGENT.to_ascii_lowercase().contains(a) {
                    a.len()
                } else {
                    usize::MAX
                }) == best
            }) {
                result.rules.extend(rules);
                result.delay = result.delay.max(delay);
            }
        }
        result
    }
    fn allowed(&self, path: &str) -> bool {
        self.rules
            .iter()
            .filter(|(_, p)| robots_match(p, path))
            .max_by_key(|(allow, p)| (p.trim_end_matches('$').replace('*', "").len(), *allow))
            .map(|(allow, _)| *allow)
            .unwrap_or(true)
    }
}
fn robots_match(pattern: &str, path: &str) -> bool {
    let anchored = pattern.ends_with('$');
    let p = pattern.trim_end_matches('$');
    let parts: Vec<_> = p.split('*').collect();
    if !path.starts_with(parts[0]) {
        return false;
    }
    let mut rest = &path[parts[0].len()..];
    for part in &parts[1..] {
        if let Some(i) = rest.find(part) {
            rest = &rest[i + part.len()..];
        } else {
            return false;
        }
    }
    !anchored || rest.is_empty()
}
pub fn normalize(base: &Url, link: &str) -> Option<Url> {
    let mut url = base.join(link).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_fragment(None);
    Some(url)
}
fn host_key(u: &Url) -> String {
    format!(
        "{}://{}:{}",
        u.scheme(),
        u.host_str().unwrap_or(""),
        u.port_or_known_default().unwrap_or(0)
    )
}
async fn wait(host: &mut Host, delay: Duration) {
    if let Some(last) = host.last {
        tokio::time::sleep_until((last + delay).into()).await;
    }
    host.last = Some(Instant::now());
}
struct Fetched {
    url: Url,
    status: StatusCode,
    body: Vec<u8>,
    location: Option<String>,
    html: bool,
}
async fn fetch(
    client: Client,
    url: Url,
    host: Arc<Mutex<Host>>,
    cfg: Config,
) -> Result<Option<Fetched>, String> {
    let mut h = host.lock().await;
    if h.robots.is_none() {
        let robots_url = url.join("/robots.txt").map_err(|e| e.to_string())?;
        wait(&mut h, cfg.delay).await;
        let res = client
            .get(robots_url)
            .send()
            .await
            .map_err(|e| format!("robots: {e}"))?;
        let status = res.status();
        let robots = if status.is_success() {
            let bytes = res.bytes().await.map_err(|e| e.to_string())?;
            if bytes.len() > MAX_BODY {
                return Err("robots too large".into());
            }
            Robots::parse(&String::from_utf8_lossy(&bytes))
        } else if status == StatusCode::NOT_FOUND || status == StatusCode::GONE {
            Robots::default()
        } else {
            return Err(format!("robots status {status}"));
        };
        h.robots = Some(robots);
    }
    let robots = h.robots.as_ref().unwrap();
    let path = match url.query() {
        Some(q) => format!("{}?{}", url.path(), q),
        None => url.path().to_string(),
    };
    if !robots.allowed(&path) {
        return Ok(None);
    }
    let delay = cfg.delay.max(robots.delay.unwrap_or_default());
    drop(h);
    for attempt in 0..=cfg.retries {
        let mut h = host.lock().await;
        wait(&mut h, delay).await;
        drop(h);
        let response = client.get(url.clone()).send().await;
        match response {
            Ok(res) => {
                let status = res.status();
                if (status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
                    && attempt < cfg.retries
                {
                    tokio::time::sleep(Duration::from_millis(200 * (1 << attempt.min(8)))).await;
                    continue;
                }
                let location = res
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned);
                let html = res
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_ascii_lowercase().contains("text/html"))
                    .unwrap_or(false);
                if res.content_length().is_some_and(|n| n > MAX_BODY as u64) {
                    return Err("body too large".into());
                }
                let bytes = res.bytes().await.map_err(|e| e.to_string())?;
                if bytes.len() > MAX_BODY {
                    return Err("body too large".into());
                }
                return Ok(Some(Fetched {
                    url,
                    status,
                    body: bytes.to_vec(),
                    location,
                    html,
                }));
            }
            Err(e) => {
                if attempt == cfg.retries {
                    return Err(e.to_string());
                }
                tokio::time::sleep(Duration::from_millis(200 * (1 << attempt.min(8)))).await;
            }
        }
    }
    unreachable!()
}
pub async fn crawl(
    seed: &str,
    out: &Path,
    cfg: Config,
) -> Result<Report, Box<dyn std::error::Error>> {
    if cfg.concurrency == 0 || cfg.max_pages == 0 {
        return Err("concurrency and max pages must be positive".into());
    }
    let seed = Url::parse(seed)?;
    let seed = normalize(&seed, seed.as_str()).ok_or("invalid seed")?;
    let origin = host_key(&seed);
    tokio::fs::create_dir_all(out.join("pages")).await?;
    let client = Client::builder()
        .user_agent(format!("{AGENT}/0.1"))
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()?;
    let start = Instant::now();
    let mut queue = VecDeque::from([seed.clone()]);
    let mut seen = HashSet::from([seed.to_string()]);
    let mut hosts: HashMap<String, Arc<Mutex<Host>>> = HashMap::new();
    let mut pending = FuturesUnordered::new();
    let mut pages = Vec::new();
    let mut hashes = HashSet::new();
    let (mut du, mut dc, mut blocked, mut errors) = (0, 0, 0, 0);
    let mut scheduled = 0;
    loop {
        while pending.len() < cfg.concurrency && scheduled < cfg.max_pages {
            let Some(url) = queue.pop_front() else { break };
            scheduled += 1;
            let host = hosts.entry(host_key(&url)).or_default().clone();
            pending.push(fetch(client.clone(), url, host, cfg.clone()));
        }
        let Some(result) = pending.next().await else {
            break;
        };
        match result {
            Ok(None) => blocked += 1,
            Err(e) => {
                eprintln!("fetch failed: {e}");
                errors += 1;
            }
            Ok(Some(f)) => {
                let mut links = Vec::new();
                if f.status.is_redirection() {
                    if let Some(location) = &f.location {
                        links.push(location.clone());
                    }
                } else if f.status.is_success() {
                    if f.html {
                        let doc = Html::parse_document(&String::from_utf8_lossy(&f.body));
                        let selector = Selector::parse("a[href]").unwrap();
                        links.extend(
                            doc.select(&selector)
                                .filter_map(|a| a.value().attr("href").map(str::to_owned)),
                        );
                    }
                    let hash = format!("{:x}", Sha256::digest(&f.body));
                    let file = format!("pages/{hash}.bin");
                    if hashes.insert(hash.clone()) {
                        tokio::fs::write(out.join(&file), &f.body).await?;
                    } else {
                        dc += 1;
                    }
                    pages.push(Page {
                        url: f.url.to_string(),
                        status: f.status.as_u16(),
                        sha256: hash,
                        file,
                    });
                } else {
                    errors += 1;
                }
                for link in links {
                    if let Some(url) = normalize(&f.url, &link) {
                        if host_key(&url) != origin {
                            continue;
                        }
                        if seen.insert(url.to_string()) {
                            queue.push_back(url);
                        } else {
                            du += 1;
                        }
                    }
                }
            }
        }
    }
    let elapsed = start.elapsed().as_secs_f64();
    let denominator = seen.len() + du;
    let report = Report {
        pages_per_second: pages.len() as f64 / elapsed.max(0.000001),
        elapsed_seconds: elapsed,
        duplicate_urls: du,
        duplicate_contents: dc,
        duplicate_rate: if denominator == 0 {
            0.0
        } else {
            du as f64 / denominator as f64
        },
        blocked,
        errors,
        pages,
    };
    tokio::fs::write(out.join("report.json"), serde_json::to_vec_pretty(&report)?).await?;
    Ok(report)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn robots_rules() {
        let r = Robots::parse(
            "User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\n",
        );
        assert!(!r.allowed("/private/x"));
        assert!(r.allowed("/private/open"));
        assert!(!r.allowed("/x.pdf"));
        assert!(r.allowed("/x.pdf?a"));
    }
    #[test]
    fn urls() {
        let u = Url::parse("https://EXAMPLE.com/a/").unwrap();
        assert_eq!(
            normalize(&u, "../b#x").unwrap().as_str(),
            "https://example.com/b"
        );
        assert!(normalize(&u, "mailto:a@b").is_none());
    }
}

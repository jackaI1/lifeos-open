use polite_web_crawler::{crawl, Config};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

#[tokio::test]
async fn synthetic_site() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let retries = Arc::new(AtomicUsize::new(0));
    let flag = stop.clone();
    let times = requests.clone();
    let attempts = retries.clone();
    let server = thread::spawn(move || {
        while !flag.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut s, _)) => {
                    s.set_nonblocking(false).unwrap();
                    let mut buf = [0; 4096];
                    let n = s.read(&mut buf).unwrap();
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let path = request
                        .lines()
                        .next()
                        .unwrap()
                        .split_whitespace()
                        .nth(1)
                        .unwrap()
                        .to_string();
                    times.lock().unwrap().push((path.clone(), Instant::now()));
                    let (status, extra, body) = match path.as_str() {
        "/robots.txt" => ("200 OK", "Content-Type: text/plain\r\n", "User-agent: *\nDisallow: /blocked\n"),
        "/" => ("200 OK", "Content-Type: text/html\r\n", "<a href='/redirect'>r<a href='/loop#one'>l<a href='/copy'>c<a href='/blocked'>b<a href='/slow'>s<a href='/retry'>retry<a href='/loop#two'>again"),
        "/redirect" => ("302 Found", "Location: /loop\r\n", ""),
        "/loop" | "/copy" => ("200 OK", "Content-Type: text/html\r\n", "<a href='/loop'>loop"),
        "/slow" => { thread::sleep(Duration::from_millis(80)); ("200 OK", "Content-Type: text/html\r\n", "<html><a href='/'><broken") },
        "/retry" if attempts.fetch_add(1, Ordering::Relaxed) == 0 => ("503 Service Unavailable", "", ""),
        "/retry" => ("200 OK", "Content-Type: text/html\r\n", "ok"),
        _ => ("404 Not Found", "", "") };
                    write!(s, "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(1))
                }
                Err(e) => panic!("{e}"),
            }
        }
    });
    let dir = std::env::temp_dir().join(format!("polite-crawler-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let result = crawl(
        &format!("http://{address}/"),
        &dir,
        Config {
            concurrency: 4,
            delay: Duration::from_millis(20),
            max_pages: 30,
            retries: 2,
        },
    )
    .await;
    stop.store(true, Ordering::Relaxed);
    server.join().unwrap();
    let report = result.unwrap();
    let times = requests.lock().unwrap();
    assert_eq!(report.pages.len(), 5);
    assert_eq!(report.blocked, 1);
    assert_eq!(report.errors, 0);
    assert!(report.duplicate_urls >= 3);
    assert_eq!(report.duplicate_contents, 1);
    assert_eq!(retries.load(Ordering::Relaxed), 2);
    assert!(!times.iter().any(|(p, _)| p == "/blocked"));
    for pair in times.windows(2) {
        assert!(pair[1].1.duration_since(pair[0].1) >= Duration::from_millis(18));
    }
    assert!(dir.join("report.json").exists());
    assert_eq!(std::fs::read_dir(dir.join("pages")).unwrap().count(), 4);
    println!(
        "synthetic: {:.2} pages/s, {:.1}% URL duplicates, {} content duplicates",
        report.pages_per_second,
        report.duplicate_rate * 100.0,
        report.duplicate_contents
    );
    std::fs::remove_dir_all(dir).unwrap();
}

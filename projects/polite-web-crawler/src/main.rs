use polite_web_crawler::{crawl, Config};
use std::{path::Path, time::Duration};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 || args.len() > 6 {
        eprintln!(
            "Usage: {} URL OUTPUT_DIR [MAX_PAGES] [CONCURRENCY] [DELAY_MS]",
            args[0]
        );
        std::process::exit(2);
    }
    let mut cfg = Config::default();
    if let Some(v) = args.get(3) {
        cfg.max_pages = v.parse()?;
    }
    if let Some(v) = args.get(4) {
        cfg.concurrency = v.parse()?;
    }
    if let Some(v) = args.get(5) {
        cfg.delay = Duration::from_millis(v.parse()?);
    }
    let report = crawl(&args[1], Path::new(&args[2]), cfg).await?;
    println!("{} pages in {:.2}s ({:.2} pages/s); URL duplicate rate {:.1}%; {} duplicate contents; {} blocked; {} errors", report.pages.len(), report.elapsed_seconds, report.pages_per_second, report.duplicate_rate * 100.0, report.duplicate_contents, report.blocked, report.errors);
    Ok(())
}

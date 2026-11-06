# polite-web-crawler

I built a web crawler to learn how the underlying idea works. This is a learning project.

## Try it

Install [Rust](https://www.rust-lang.org/tools/install), then run:

```sh
cargo run --release -- https://example.com/ crawl-output 100 8 500
```

The last three numbers are the maximum number of addresses to try, the number of requests that can be in progress, and the minimum milliseconds between requests to the same origin (scheme, host and port). They are optional and default to 100, 8 and 500. Only crawl sites you are allowed to access. The program prints pages per second and the percentage of discovered addresses that were repeats. Results are in `crawl-output/report.json`; page bodies are in `crawl-output/pages/`.

## How it works

Each address is made consistent by resolving relative links and removing fragments (the part after `#`). A set prevents the crawler from visiting the same address twice, including links that loop back. Redirects are checked as new addresses, so their targets must also pass robots rules. The crawler stays on the starting origin; links to other origins are ignored.

For each origin, a lock keeps requests apart by the configured delay or the site's longer `Crawl-delay`. The crawler retries temporary failures with increasing waits. If robots.txt is unavailable due to an error, it fails closed for that request; a missing robots.txt permits access. Robots rules support user-agent groups, allow/disallow, `*` and end-of-path `$`. It uses the most specific matching rule, with allow winning a tie. This is a practical subset, not a complete implementation of every robots.txt edge case. Each successful body is named by its SHA-256 hash, a fingerprint of its bytes, so identical content is stored once while the report records each address. Bodies larger than 2 MB are rejected.

## Tests and limits

There are 1 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



Retained project workflows: `polite-web-crawler-ci.yml`. Their commands use this folder and their triggers use its paths.

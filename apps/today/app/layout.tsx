import "./style.css";
import Link from "next/link";
export const metadata = {
  title: "LifeOS study desk",
  description: "A fictional day, report plan and public guide",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/">LifeOS study desk</Link>
          <nav aria-label="Study tools">
            <Link href="/">Today</Link>
            <Link href="/plan">Report plan</Link>
            <Link href="/questions">Public guide</Link>
            <Link href="/picks">Pick trials</Link>
          </nav>
        </header>
        {children}
        <footer>Fictional examples. Separate from my private workspace.</footer>
      </body>
    </html>
  );
}

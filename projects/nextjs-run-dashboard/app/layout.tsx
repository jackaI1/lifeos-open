import './globals.css';
import Link from 'next/link';
export const metadata={title:'Runbook | Browser traces',description:'Inspect browser automation runs'};
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en"><body><a className="skip" href="#main">Skip to content</a><header><Link href="/" className="brand"><span className="brand-icon">R</span> Runbook</Link><span className="header-note">Browser trace explorer</span></header><main id="main">{children}</main><footer>Runbook <span> / </span> Synthetic browser traces</footer></body></html>; }

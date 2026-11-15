import type {ReactNode} from 'react';

export const metadata = {title: 'LifeOS schedule'};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body style={{fontFamily: 'system-ui, sans-serif', margin: '2rem', maxWidth: '44rem'}}>{children}</body>
    </html>
  );
}

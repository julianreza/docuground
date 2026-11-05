import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DocuGround',
  description: 'Document extraction with source evidence',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return <html lang="en"><body>{children}</body></html>;
}

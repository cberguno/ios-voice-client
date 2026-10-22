import type { ReactNode } from "react";

export const metadata = {
  title: "Voice API",
  description: "Private voice backend for the iPhone voice client",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

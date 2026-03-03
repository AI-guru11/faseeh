import "./globals.css";

export const metadata = {
  title: "فصيح — Arabic TTS Studio",
  description: "Arabic TTS Studio with Tashkeel Editor",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

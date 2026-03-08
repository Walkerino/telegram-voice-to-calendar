import { Space_Grotesk } from "next/font/google";
import { MiniAppVoiceRecorder } from "./voice-recorder";
import styles from "./miniapp.module.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"]
});

export default function MiniAppPage() {
  return (
    <main className={`${styles.page} ${spaceGrotesk.className}`}>
      <div className={styles.glowA} />
      <div className={styles.glowB} />
      <section className={styles.card}>
        <h1 className={styles.title}>Voice Calendar</h1>
        <p className={styles.subtitle}>Нажмите и продиктуйте событие. Например: Завтра встреча в 11 утра.</p>
        <MiniAppVoiceRecorder />
      </section>
    </main>
  );
}

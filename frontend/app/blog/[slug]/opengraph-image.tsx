import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { staticSlugs, visiblePost } from "@/lib/blog/posts";
import { categoryByKey } from "@/lib/blog/taxonomy";
import { ACCENTS, traceDataUri } from "@/lib/trace";

// One share image per article: its title, topic and trace plate, with the official mark (unaltered).
export const runtime = "nodejs";
export const alt = "Ensemblis Blog article";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return staticSlugs().map((slug) => ({ slug }));
}

const mark = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "public/brand/ensemblis-mark-96.png")).toString("base64")}`;

export default function Image({ params }: { params: { slug: string } }) {
  // Only what the reader may already see: a draft's or scheduled article's title never leaks through its image
  // (it shows the generic blog card until publication, then updates on the next revalidation).
  const post = visiblePost(params.slug);
  const accent = ACCENTS[post?.category ?? ""] ?? ACCENTS.default;
  const title = post?.title ?? "Ensemblis Blog";
  const topic = post ? categoryByKey(post.category)?.name : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#07111f", color: "#f6f8fb" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={traceDataUri(params.slug, accent)} width={780} height={410} alt="" style={{ position: "absolute", left: 420, top: 70, opacity: 0.9 }} />
        {/* Satori has no `inset`: explicit box. Solid behind the text, fading over the trace. */}
        <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630, background: "linear-gradient(90deg, #07111f 0%, #07111f 52%, rgba(7,17,31,0.55) 75%, rgba(7,17,31,0.1) 100%)", display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: "100%", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mark} width={48} height={48} alt="" />
            <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: 6 }}>ENSEMBLIS</span>
            <span style={{ fontSize: 26, color: "#8fa0b4", marginLeft: 8 }}>Blog</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 860 }}>
            {topic && <span style={{ fontSize: 24, color: accent, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 20 }}>{topic}</span>}
            <span style={{ fontSize: title.length > 70 ? 52 : 62, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1 }}>{title}</span>
          </div>
          <span style={{ fontSize: 22, color: "#a3b1c2" }}>getensemblis.com/blog</span>
        </div>
      </div>
    ),
    size
  );
}

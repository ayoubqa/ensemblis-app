import type { Metadata } from "next";
import type { GalleryItem } from "@/lib/api";
import { fetchPublicJson, reportMetadata } from "@/components/report/server";
import { ExampleDetail } from "./ExampleDetail";

type Props = { params: { slug: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await fetchPublicJson<{ item: GalleryItem }>(`/api/gallery/${encodeURIComponent(params.slug)}`);
  const item = data?.item;
  if (!item) {
    return { title: "Example report", description: "A finished report with numbered sources, produced by a team of AI agents on Ensemblis." };
  }
  return reportMetadata({
    title: item.title,
    markdown: item.summary || item.content,
    kicker: item.isExample ? "Example report" : "Featured report",
    fallbackDescription: "A finished report with numbered sources, produced by a team of AI agents on Ensemblis.",
  });
}

export default function ExampleDetailPage({ params }: Props) {
  return <ExampleDetail slug={params.slug} />;
}

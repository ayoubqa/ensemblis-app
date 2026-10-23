import type { Metadata } from "next";
import type { PublicReport } from "@/lib/api";
import { fetchPublicJson, reportMetadata } from "@/components/report/server";
import { SharedReport } from "./SharedReport";

type Props = { params: { token: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await fetchPublicJson<{ report: PublicReport }>(`/api/public/reports/${encodeURIComponent(params.token)}`);
  if (!data?.report) {
    return {
      title: "Shared result",
      description: "A result shared from Ensemblis, the AI operating layer for business.",
      robots: { index: false, follow: false },
    };
  }
  return reportMetadata({
    title: data.report.title,
    markdown: data.report.result,
    kicker: data.report.kind === "execution" ? "Shared result" : "Earlier report",
    fallbackDescription: "A result shared from Ensemblis, the AI operating layer for business.",
    // Shared links are unlisted: previews work, search engines stay out.
    noindex: true,
  });
}

export default function SharedReportPage({ params }: Props) {
  return <SharedReport token={params.token} />;
}

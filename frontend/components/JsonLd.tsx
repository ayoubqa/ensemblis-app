/** Renders schema.org JSON-LD. Server component; data must be truthful (see lib/site.ts). */
export function JsonLd({ data }: { data: object | object[] }) {
  // "<" is escaped so no string in the data can close the script element.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export default JsonLd;

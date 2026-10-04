import { num } from "@/lib/format";

/** "1,240 / 4,000" — live counter under long text inputs; turns red when over (or within 5% of) the limit. */
export function CharCount({ value, max, id, className, style }: { value: string; max: number; id?: string; className?: string; style?: React.CSSProperties }) {
  const n = value.length;
  const over = n > max;
  const near = !over && n >= max * 0.95;
  return (
    <span id={id} className={`charcount${over || near ? " over" : ""}${className ? " " + className : ""}`} style={style} aria-live={near || over ? "polite" : "off"}>
      {num(n)} / {num(max)}
      <span className="sr-only"> characters{over ? " — too long" : ""}</span>
    </span>
  );
}

export default CharCount;

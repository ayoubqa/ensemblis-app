// /health/live says which commit the API runs, so the production smoke can tell whether a backend change is live.
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../helpers";

const saved = process.env.RENDER_GIT_COMMIT;
afterEach(() => {
  if (saved === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = saved;
});

describe("/health/live", () => {
  it("reports the short commit Render deployed, or null off Render", async () => {
    process.env.RENDER_GIT_COMMIT = "6e62e77a1b2c3d4e5f60718293a4b5c6d7e8f901";
    expect((await api().get("/health/live").expect(200)).body).toEqual({ ok: true, release: "6e62e77" });
    delete process.env.RENDER_GIT_COMMIT;
    expect((await api().get("/health/live").expect(200)).body).toEqual({ ok: true, release: null });
  });
});

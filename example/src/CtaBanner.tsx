import { Atmosphere } from "./lib/Atmosphere.js";
import { GhostButton, InstallBar } from "./lib/buttons.js";

/** The closing banner, after boxd.sh's CtaSection: the hero's ask, once more. */
export function CtaBanner() {
  return (
    <section className="cta">
      <Atmosphere />
      <div className="cta-copy">
        <h2>Give every user their own machine</h2>
        <p>
          Install the component, add your boxd API key, and boot machines from
          any Convex action.
        </p>
        <div className="start">
          <InstallBar command="npm install @boxd-sh/convex" />
          <GhostButton href="https://github.com/azin-tech/boxd-convex">
            GitHub
          </GhostButton>
        </div>
      </div>
    </section>
  );
}

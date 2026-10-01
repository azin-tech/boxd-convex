import { BoxMark } from "./lib/NotchedPanel.js";

/** The boxd site footer, ported from boxd/website's Footer. */
const COLUMNS: [string, [string, string][]][] = [
  [
    "Product",
    [
      ["Get started", "https://boxd.sh/app"],
      ["Pricing", "https://boxd.sh/pricing"],
      ["Use Cases", "https://docs.boxd.sh/use-cases/"],
      ["Guides", "https://docs.boxd.sh/guides/"],
    ],
  ],
  [
    "Resources",
    [
      ["Documentation", "https://docs.boxd.sh"],
      ["Blog", "https://boxd.sh/blog"],
      ["LinkedIn", "https://www.linkedin.com/company/boxdsh/"],
      ["X", "https://x.com/boxd_sh"],
    ],
  ],
  [
    "Company",
    [
      ["Contact", "https://boxd.sh/contact"],
      ["Careers", "https://boxd.sh/careers"],
      ["Privacy", "https://boxd.sh/privacy"],
      ["Terms", "https://boxd.sh/terms"],
    ],
  ],
];

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="page-inner">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="https://boxd.sh" className="footer-mark">
              <BoxMark size={20} fill="white" />
              <span>boxd</span>
            </a>
            <p>Composable computers for Devs and Agents.</p>
          </div>
          <div className="footer-cols">
            {COLUMNS.map(([title, links]) => (
              <div key={title}>
                <h3>{title}</h3>
                <ul>
                  {links.map(([label, href]) => (
                    <li key={label}>
                      <a href={href}>{label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2026 boxd</p>
        </div>
      </div>
    </footer>
  );
}

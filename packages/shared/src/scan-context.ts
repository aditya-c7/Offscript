/**
 * Shared data contract passed between the scanner crawler/browser and the
 * 31 deterministic checks, protocol detectors, scorer and report builder.
 * Both producer (crawler/browser) and consumers import these types from
 * `@offscript/shared` so no package redefines them locally.
 */

export interface LinkInfo {
  text: string;
  href: string | null;
  raw: string;
  rel: string;
}

export interface FieldInfo {
  name: string;
  type: string;
  id: string | null;
  label: string | null;
  autocomplete: string | null;
  required: boolean;
  tag: string;
  selector: string;
}

export interface ButtonInfo {
  text: string;
  ariaLabel: string | null;
  type: string | null;
  selector: string;
  hasOnClick: boolean;
  disabled: boolean;
}

export interface FormInfo {
  action: string | null;
  method: string | null;
  fields: FieldInfo[];
  buttons: ButtonInfo[];
  hasLiveRegion: boolean;
  selector: string;
}

export interface HeadingInfo {
  level: number;
  text: string;
}

export interface ImageInfo {
  src: string;
  alt: string | null;
  width: number;
  height: number;
}

export interface PageSnapshot {
  url: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  /** HTML as delivered with JavaScript disabled. */
  rawHtml: string;
  /** HTML after hydration / DOM settle. */
  renderedHtml: string;
  /** All text content, normalized whitespace. */
  text: string;
  /** Text visible to a sighted user. */
  visibleText: string;
  title: string;
  lang: string | null;
  description: string | null;
  canonical: string | null;
  jsonLd: unknown[];
  links: LinkInfo[];
  forms: FormInfo[];
  buttons: ButtonInfo[];
  headings: HeadingInfo[];
  landmarks: {
    main: boolean;
    header: boolean;
    nav: boolean;
    footer: boolean;
  };
  images: ImageInfo[];
  canvasCount: number;
  iframeCount: number;
  ariaLiveCount: number;
  ariaDialogCount: number;
  ariaAlertCount: number;
  feedbackSurfaces: string[];
  stateAttrs: string[];
  pageErrors: string[];
  cls: number;
  settledMs: number;
  /** SHA-256 of the settled body text — used for parity / loop detection. */
  bodyHash: string;
}

export interface ScanContext {
  submittedUrl: string;
  normalizedUrl: string;
  host: string;
  pages: PageSnapshot[];
  robotsTxt: string;
  sitemapXml: string;
  headersByUrl: Record<string, Record<string, string>>;
  aiBotStatus: number;
  aiBotText: string;
  chromeStatus: number;
  chromeText: string;
  protocolsRaw: Record<string, unknown>;
  httpsRedirectOk: boolean;
  notFoundStatus: number;
  possiblePagesFound: number;
  sampledUrls: string[];
  detectedStack:
    "generic" | "nextjs" | "shopify" | "webflow" | "wordpress" | "builder";
}

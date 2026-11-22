import type { Area, Category, Impact, Stack, TaskKey } from "./schemas.js";

/** Stable identifiers for all 31 static checks (offscript.rubric/v2.0.0). */
export const CHECK_KEYS = [
  "browser.navigation_semantics",
  "retrieval.sitemap_freshness",
  "retrieval.canonical_urls",
  "retrieval.http_404_semantics",
  "retrieval.https_enforcement",
  "retrieval.ai_bot_http_access",
  "retrieval.robots_user_acting_agents",
  "retrieval.human_agent_parity",
  "content.basic_a11y_alt_lang",
  "browser.dom_stability",
  "content.initial_ssr_facts",
  "content.landmarks",
  "content.heading_hierarchy",
  "browser.reliable_rendering",
  "content.structured_data_jsonld",
  "interaction.side_effect_boundaries",
  "interaction.outcome_observability",
  "browser.coordinate_only_risk",
  "interaction.control_contract",
  "browser.feedback_surfaces",
  "interaction.accessible_button_names",
  "interaction.form_field_labeling",
  "interaction.state_announcements",
  "identity.operator_name",
  "retrieval.trust_pages",
  "identity.about_page",
  "identity.privacy_policy",
  "identity.terms_of_service",
  "identity.returns_refunds",
  "identity.external_profiles",
  "identity.pricing_offering_clarity",
] as const;

export type CheckKey = (typeof CHECK_KEYS)[number];

export interface CheckMeta {
  key: CheckKey;
  category: Category;
  area: Area;
  impact: Impact;
  title: string;
}

export const CHECK_META: Record<CheckKey, CheckMeta> = {
  "browser.navigation_semantics": {
    key: "browser.navigation_semantics",
    category: "reaching",
    area: "find",
    impact: "major",
    title: "Real links for navigation",
  },
  "retrieval.sitemap_freshness": {
    key: "retrieval.sitemap_freshness",
    category: "reaching",
    area: "find",
    impact: "supporting",
    title: "Fresh sitemap.xml",
  },
  "retrieval.canonical_urls": {
    key: "retrieval.canonical_urls",
    category: "reaching",
    area: "find",
    impact: "supporting",
    title: "Absolute HTTPS canonical URLs",
  },
  "retrieval.http_404_semantics": {
    key: "retrieval.http_404_semantics",
    category: "reaching",
    area: "find",
    impact: "major",
    title: "True 404 responses",
  },
  "retrieval.https_enforcement": {
    key: "retrieval.https_enforcement",
    category: "reaching",
    area: "find",
    impact: "major",
    title: "HTTPS enforced",
  },
  "retrieval.ai_bot_http_access": {
    key: "retrieval.ai_bot_http_access",
    category: "reaching",
    area: "find",
    impact: "major",
    title: "AI bots can fetch pages",
  },
  "retrieval.robots_user_acting_agents": {
    key: "retrieval.robots_user_acting_agents",
    category: "reaching",
    area: "find",
    impact: "major",
    title: "robots.txt allows AI agents",
  },
  "retrieval.human_agent_parity": {
    key: "retrieval.human_agent_parity",
    category: "reaching",
    area: "find",
    impact: "major",
    title: "No cloaking (human/agent parity)",
  },
  "content.basic_a11y_alt_lang": {
    key: "content.basic_a11y_alt_lang",
    category: "reading",
    area: "understand",
    impact: "major",
    title: "Language, title, description, image alts",
  },
  "browser.dom_stability": {
    key: "browser.dom_stability",
    category: "reading",
    area: "understand",
    impact: "supporting",
    title: "Stable layout (low CLS)",
  },
  "content.initial_ssr_facts": {
    key: "content.initial_ssr_facts",
    category: "reading",
    area: "understand",
    impact: "major",
    title: "Key facts in server HTML",
  },
  "content.landmarks": {
    key: "content.landmarks",
    category: "reading",
    area: "understand",
    impact: "supporting",
    title: "Semantic landmarks",
  },
  "content.heading_hierarchy": {
    key: "content.heading_hierarchy",
    category: "reading",
    area: "understand",
    impact: "supporting",
    title: "Clean heading outline",
  },
  "browser.reliable_rendering": {
    key: "browser.reliable_rendering",
    category: "reading",
    area: "understand",
    impact: "major",
    title: "No page/console crashes",
  },
  "content.structured_data_jsonld": {
    key: "content.structured_data_jsonld",
    category: "reading",
    area: "understand",
    impact: "major",
    title: "Valid JSON-LD structured data",
  },
  "interaction.side_effect_boundaries": {
    key: "interaction.side_effect_boundaries",
    category: "act",
    area: "act",
    impact: "major",
    title: "Confirmation for risky actions",
  },
  "interaction.outcome_observability": {
    key: "interaction.outcome_observability",
    category: "act",
    area: "act",
    impact: "supporting",
    title: "Observable action outcomes",
  },
  "browser.coordinate_only_risk": {
    key: "browser.coordinate_only_risk",
    category: "act",
    area: "act",
    impact: "major",
    title: "Not coordinate-only UI",
  },
  "interaction.control_contract": {
    key: "interaction.control_contract",
    category: "act",
    area: "act",
    impact: "major",
    title: "Native form controls",
  },
  "browser.feedback_surfaces": {
    key: "browser.feedback_surfaces",
    category: "act",
    area: "act",
    impact: "supporting",
    title: "ARIA feedback surfaces",
  },
  "interaction.accessible_button_names": {
    key: "interaction.accessible_button_names",
    category: "act",
    area: "act",
    impact: "major",
    title: "Accessible button names",
  },
  "interaction.form_field_labeling": {
    key: "interaction.form_field_labeling",
    category: "act",
    area: "act",
    impact: "major",
    title: "Labeled form fields",
  },
  "interaction.state_announcements": {
    key: "interaction.state_announcements",
    category: "act",
    area: "act",
    impact: "supporting",
    title: "State announcements",
  },
  "identity.operator_name": {
    key: "identity.operator_name",
    category: "identity",
    area: "understand",
    impact: "major",
    title: "Operator name is clear",
  },
  "retrieval.trust_pages": {
    key: "retrieval.trust_pages",
    category: "identity",
    area: "find",
    impact: "major",
    title: "Reachable contact details",
  },
  "identity.about_page": {
    key: "identity.about_page",
    category: "identity",
    area: "understand",
    impact: "supporting",
    title: "About page",
  },
  "identity.privacy_policy": {
    key: "identity.privacy_policy",
    category: "identity",
    area: "understand",
    impact: "major",
    title: "Privacy policy",
  },
  "identity.terms_of_service": {
    key: "identity.terms_of_service",
    category: "identity",
    area: "understand",
    impact: "major",
    title: "Terms of service",
  },
  "identity.returns_refunds": {
    key: "identity.returns_refunds",
    category: "identity",
    area: "understand",
    impact: "supporting",
    title: "Returns / refunds policy",
  },
  "identity.external_profiles": {
    key: "identity.external_profiles",
    category: "identity",
    area: "understand",
    impact: "supporting",
    title: "Verified external profiles",
  },
  "identity.pricing_offering_clarity": {
    key: "identity.pricing_offering_clarity",
    category: "identity",
    area: "understand",
    impact: "major",
    title: "Clear offerings and pricing",
  },
};

export const CATEGORY_META = [
  {
    key: "reaching",
    title: "01 · Reaching your pages",
    subtitle: "Can agents open your site and find your pages?",
  },
  {
    key: "reading",
    title: "02 · Reading your pages",
    subtitle: "Can agents read your pages and tell what is on them?",
  },
  {
    key: "act",
    title: "03 · Using forms and buttons",
    subtitle: "Can agents tell what your buttons and forms do?",
  },
  {
    key: "identity",
    title: "04 · Knowing who you are",
    subtitle: "Can agents tell who runs the site and how to reach you?",
  },
] as const;

export const PROTOCOL_KEYS = [
  "llms_txt",
  "mcp",
  "webmcp",
  "a2a",
  "openapi",
  "markdown_negotiation",
  "content_signals",
] as const;

export const PROTOCOL_META = [
  {
    key: "llms_txt",
    title: "llms.txt",
    description: "A short guide to your site, written for AI tools.",
  },
  {
    key: "mcp",
    title: "MCP",
    description: "A server that lets AI agents use your service directly.",
  },
  {
    key: "webmcp",
    title: "WebMCP",
    description: "Actions your pages offer to AI agents in the browser.",
  },
  {
    key: "a2a",
    title: "A2A",
    description:
      "A card that lets other AI agents find and talk to your own agent.",
  },
  {
    key: "openapi",
    title: "OpenAPI",
    description: "A description of your API that agents can read.",
  },
  {
    key: "markdown_negotiation",
    title: "Markdown",
    description: "A text-only version of your pages for AI tools that ask.",
  },
  {
    key: "content_signals",
    title: "Content signals",
    description:
      "Rules in robots.txt (and HTTP header) for how AI may use your content.",
  },
] as const;

export const STACKS: ReadonlyArray<{ key: Stack; label: string }> = [
  { key: "generic", label: "Something else, or not sure" },
  { key: "nextjs", label: "Next.js" },
  { key: "shopify", label: "Shopify" },
  { key: "webflow", label: "Webflow" },
  { key: "wordpress", label: "WordPress" },
  { key: "builder", label: "A site builder (Wix, Squarespace...)" },
];

export const PRESETS: ReadonlyArray<{
  key: TaskKey;
  label: string;
  task: string;
  success: string;
}> = [
  {
    key: "offers",
    label: "Find what the site offers",
    task: "Find what this site offers. List the main products or services described on the site.",
    success:
      "Names at least one real product or service that is visible on the site.",
  },
  {
    key: "price",
    label: "Find the price of the main offering",
    task: "Find the price of the main offering on this site. Report the exact price and currency if shown.",
    success:
      "Reports a specific price that appears on the site, or states clearly that no price is shown.",
  },
  {
    key: "contact",
    label: "Find how to contact the business",
    task: "Find how to contact the business. Report an email address, phone number, or contact page URL.",
    success: "Provides a real contact method that is present on the site.",
  },
];

export const RUBRIC_VERSION = "offscript.rubric/v2.0.0";
export const PIPELINE_VERSION = "offscript-pipeline/v2.2.0";

export const MAX_AGENT_STEPS = 25;
export const MAX_AGENT_WALL_MS = 300_000;
export const MAX_TURN_INPUT_TOKENS = 12_000;
export const ARTIFACT_TTL_DAYS = 30;

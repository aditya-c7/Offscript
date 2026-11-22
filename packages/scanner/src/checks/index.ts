/** Registry that produces the 31 static checks in CHECK_KEYS order. */
import {
  CHECK_KEYS,
  type CheckKey,
  type CheckResult,
  type ScanContext,
} from "@offscript/shared";
import {
  checkCoordinateOnlyRisk,
  checkDomStability,
  checkFeedbackSurfaces,
  checkNavigationSemantics,
  checkReliableRendering,
} from "./browser.js";
import {
  checkBasicA11yAltLang,
  checkHeadingHierarchy,
  checkInitialSsrFacts,
  checkLandmarks,
  checkStructuredDataJsonLd,
} from "./content.js";
import {
  checkAccessibleButtonNames,
  checkControlContract,
  checkFormFieldLabeling,
  checkOutcomeObservability,
  checkSideEffectBoundaries,
  checkStateAnnouncements,
} from "./interaction.js";
import {
  checkAboutPage,
  checkExternalProfiles,
  checkOperatorName,
  checkPrivacyPolicy,
  checkPricingOfferingClarity,
  checkReturnsRefunds,
  checkTermsOfService,
} from "./identity.js";
import {
  checkAiBotHttpAccess,
  checkCanonicalUrls,
  checkHumanAgentParity,
  checkHttpsEnforcement,
  checkHttp404Semantics,
  checkRobotsUserActingAgents,
  checkSitemapFreshness,
  checkTrustPages,
} from "./retrieval.js";

export {
  checkCoordinateOnlyRisk,
  checkDomStability,
  checkFeedbackSurfaces,
  checkNavigationSemantics,
  checkReliableRendering,
  checkBasicA11yAltLang,
  checkHeadingHierarchy,
  checkInitialSsrFacts,
  checkLandmarks,
  checkStructuredDataJsonLd,
  checkAccessibleButtonNames,
  checkControlContract,
  checkFormFieldLabeling,
  checkOutcomeObservability,
  checkSideEffectBoundaries,
  checkStateAnnouncements,
  checkAboutPage,
  checkExternalProfiles,
  checkOperatorName,
  checkPrivacyPolicy,
  checkPricingOfferingClarity,
  checkReturnsRefunds,
  checkTermsOfService,
  checkAiBotHttpAccess,
  checkCanonicalUrls,
  checkHumanAgentParity,
  checkHttpsEnforcement,
  checkHttp404Semantics,
  checkRobotsUserActingAgents,
  checkSitemapFreshness,
  checkTrustPages,
};

const CHECK_FUNCTIONS: Record<CheckKey, (ctx: ScanContext) => CheckResult> = {
  "browser.navigation_semantics": checkNavigationSemantics,
  "retrieval.sitemap_freshness": checkSitemapFreshness,
  "retrieval.canonical_urls": checkCanonicalUrls,
  "retrieval.http_404_semantics": checkHttp404Semantics,
  "retrieval.https_enforcement": checkHttpsEnforcement,
  "retrieval.ai_bot_http_access": checkAiBotHttpAccess,
  "retrieval.robots_user_acting_agents": checkRobotsUserActingAgents,
  "retrieval.human_agent_parity": checkHumanAgentParity,
  "content.basic_a11y_alt_lang": checkBasicA11yAltLang,
  "browser.dom_stability": checkDomStability,
  "content.initial_ssr_facts": checkInitialSsrFacts,
  "content.landmarks": checkLandmarks,
  "content.heading_hierarchy": checkHeadingHierarchy,
  "browser.reliable_rendering": checkReliableRendering,
  "content.structured_data_jsonld": checkStructuredDataJsonLd,
  "interaction.side_effect_boundaries": checkSideEffectBoundaries,
  "interaction.outcome_observability": checkOutcomeObservability,
  "browser.coordinate_only_risk": checkCoordinateOnlyRisk,
  "interaction.control_contract": checkControlContract,
  "browser.feedback_surfaces": checkFeedbackSurfaces,
  "interaction.accessible_button_names": checkAccessibleButtonNames,
  "interaction.form_field_labeling": checkFormFieldLabeling,
  "interaction.state_announcements": checkStateAnnouncements,
  "identity.operator_name": checkOperatorName,
  "retrieval.trust_pages": checkTrustPages,
  "identity.about_page": checkAboutPage,
  "identity.privacy_policy": checkPrivacyPolicy,
  "identity.terms_of_service": checkTermsOfService,
  "identity.returns_refunds": checkReturnsRefunds,
  "identity.external_profiles": checkExternalProfiles,
  "identity.pricing_offering_clarity": checkPricingOfferingClarity,
};

/**
 * Run every deterministic check. Output order is exactly CHECK_KEYS order and
 * nothing here performs network or LLM calls.
 */
export function runChecks(ctx: ScanContext): CheckResult[] {
  return CHECK_KEYS.map((key) => CHECK_FUNCTIONS[key](ctx));
}

export const offerCopyConfig = {
  defaultCta: "Claim bundle",
  defaultHeadline: "A nearby local break is ready.",
  contextualHeadlines: [
    {
      weatherMood: "cold",
      declaredIntentIncludes: "warm",
      headline: "Cold outside? Make it a warm city break.",
    },
  ],
  twoStopSubheadlineTemplate: "Start with a {firstProduct} nearby, then get cashback on a {secondProduct} around the corner.",
} as const;

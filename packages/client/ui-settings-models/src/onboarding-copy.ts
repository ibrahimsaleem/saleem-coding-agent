/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** The complete editable welcome notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎',
    body: 'Saleem Harness 仍在积极开发中，核心插件与基础 API 可能会快速演化。',
    continueLabel: '继续',
  },
  en: {
    title: 'Welcome',
    body: 'Saleem Harness is under active development; core plugins and foundational APIs may evolve quickly.',
    continueLabel: 'Continue',
  },
} as const

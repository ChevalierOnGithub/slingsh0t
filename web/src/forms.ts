/**
 * After a successful add, the busy-disabled submit button has dropped focus to <body>: put it on the form's first
 * usable field (not a hidden input, not disabled, not inside a hidden part of the form).
 */
export const focusFirstField = (form: HTMLFormElement) =>
  [...form.querySelectorAll<HTMLInputElement>('input:not([type=hidden]), select, textarea')]
    .find((el) => !el.disabled && !el.closest('[hidden]'))
    ?.focus()

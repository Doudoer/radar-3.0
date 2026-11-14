import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface DialogAccessibilityOptions {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onEscape: () => void;
  /** Lets a parent dialog step aside while a nested dialog owns focus and Escape. */
  isBlocked?: () => boolean;
}

export const useDialogAccessibility = ({ open, dialogRef, onEscape, isBlocked }: DialogAccessibilityOptions) => {
  const escapeHandlerRef = useRef(onEscape);
  escapeHandlerRef.current = onEscape;
  const isBlockedRef = useRef(isBlocked);
  isBlockedRef.current = isBlocked;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = (): HTMLElement[] => {
      const elements: HTMLElement[] = [];
      dialog.querySelectorAll(FOCUSABLE_SELECTOR).forEach((element) => {
        if (element instanceof HTMLElement && element.getClientRects().length > 0) {
          elements.push(element);
        }
      });
      return elements;
    };

    dialog.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isBlockedRef.current?.()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        escapeHandlerRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;

      if (!(active instanceof Node) || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, dialogRef]);
};

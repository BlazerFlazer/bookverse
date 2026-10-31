import { AnimatePresence, motion } from 'motion/react';
import { useToasts } from '../stores/toasts.ts';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            type="button"
            layout
            className={`toast toast-${toast.kind}`}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.32, ease: [0.22, 0.72, 0.18, 1] }}
            onClick={() => dismiss(toast.id)}
          >
            {toast.icon && <span className="toast-icon" aria-hidden="true">{toast.icon}</span>}
            <span>
              {toast.kind === 'achievement' && <span className="eyebrow block">Достижение</span>}
              <span className="toast-title">{toast.title}</span>
              {toast.body && <span className="toast-body">{toast.body}</span>}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

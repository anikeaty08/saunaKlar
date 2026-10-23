import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon.tsx';
import './EmptyState.css';

export function EmptyState({ icon, title, body, action, compact }: { icon?: LucideIcon; title: ReactNode; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={['empty', compact && 'empty--compact'].filter(Boolean).join(' ')}>
      {icon && (
        <span className="empty__icon">
          <Icon icon={icon} size="lg" strokeWidth={1.25} />
        </span>
      )}
      <h3 className="empty__title">{title}</h3>
      {body && <p className="empty__body">{body}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

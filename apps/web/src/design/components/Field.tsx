import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Icon } from './Icon.tsx';
import { useT } from '../../i18n/i18n.ts';
import './Field.css';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | string[] | null;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Label, control, hint and error, wired with ids and aria attributes. */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const { t } = useT();
  const err = Array.isArray(error) ? error[0] : error;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = err ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['field', err && 'field--invalid', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? <span className="field__req" aria-hidden="true">*</span> : <span className="field__opt">{t('common.optional')}</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(err) })}
      {hint && !err && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {err && (
        <p className="field__error" id={errId} role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

type Base = { label: ReactNode; hint?: ReactNode; error?: string | string[] | null };

export const Input = forwardRef<HTMLInputElement, Base & InputHTMLAttributes<HTMLInputElement>>(function Input({ label, hint, error, required, className, type, ...rest }, ref) {
  const [show, setShow] = useState(false);
  const { t } = useT();
  const isPassword = type === 'password';
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="control">
          <input
            ref={ref}
            id={id}
            className="control__input"
            type={isPassword && show ? 'text' : type}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            {...rest}
          />
          {isPassword && (
            <button type="button" className="control__affix" onClick={() => setShow(s => !s)} aria-label={show ? t('common.hidePassword') : t('common.showPassword')} aria-pressed={show}>
              <Icon icon={show ? EyeOff : Eye} size="sm" />
            </button>
          )}
        </div>
      )}
    </Field>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, Base & TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ label, hint, error, required, className, rows = 4, ...rest }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="control">
          <textarea ref={ref} id={id} rows={rows} className="control__input control__input--area" required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest} />
        </div>
      )}
    </Field>
  );
});

export const Select = forwardRef<HTMLSelectElement, Base & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }>(function Select(
  { label, hint, error, required, className, options, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="control control--select">
          <select ref={ref} id={id} className="control__input" required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest}>
            {options.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon icon={ChevronDown} size="sm" className="control__chevron" />
        </div>
      )}
    </Field>
  );
});

type CheckProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; error?: string | null; description?: ReactNode };

export const Checkbox = forwardRef<HTMLInputElement, CheckProps>(function Checkbox({ label, error, description, className, id: idProp, ...rest }, ref) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={['check', error && 'check--invalid', className].filter(Boolean).join(' ')}>
      <input ref={ref} id={id} type="checkbox" className="check__input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} {...rest} />
      <label htmlFor={id} className="check__label">
        <span className="check__box" aria-hidden="true">
          <Icon icon={Check} size="xs" strokeWidth={2.5} />
        </span>
        <span>
          {label}
          {description && <span className="check__desc">{description}</span>}
        </span>
      </label>
      {error && (
        <p className="field__error" id={`${id}-err`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

export const Radio = forwardRef<HTMLInputElement, CheckProps>(function Radio({ label, description, className, id: idProp, ...rest }, ref) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={['check', 'check--radio', className].filter(Boolean).join(' ')}>
      <input ref={ref} id={id} type="radio" className="check__input" {...rest} />
      <label htmlFor={id} className="check__label">
        <span className="check__box" aria-hidden="true" />
        <span>
          {label}
          {description && <span className="check__desc">{description}</span>}
        </span>
      </label>
    </div>
  );
});

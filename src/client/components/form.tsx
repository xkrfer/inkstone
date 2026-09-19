import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Check } from 'lucide-react'
import { cn } from '../lib/cn'
import { Tooltip } from './overlay'

const FIELD_BASE = cn(
  'w-full rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--bg-inset)]',
  'px-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]',
  'transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
  'focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-ring)] focus:outline-none',
  'disabled:opacity-50',
)

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>
  leading?: ReactNode
  trailing?: ReactNode
  invalid?: boolean
}

export function Input({
  className,
  leading,
  trailing,
  invalid,
  'aria-invalid': ariaInvalid,
  ...rest
}: InputProps) {
  const accessibleInvalid = invalid ? true : ariaInvalid
  if (leading || trailing) {
    return (
      <div className="relative flex items-center">
        {leading && (
          <span className="pointer-events-none absolute left-2.5 text-[var(--text-quaternary)]">
            {leading}
          </span>
        )}
        <input
          {...rest}
          aria-invalid={accessibleInvalid}
          className={cn(
            FIELD_BASE,
            'h-11 md:h-[34px]',
            leading && 'pl-8',
            trailing && 'pr-8',
            invalid && 'border-[var(--danger)]',
            className,
          )}
        />
        {trailing && <span className="absolute right-2.5 flex items-center">{trailing}</span>}
      </div>
    )
  }
  return (
    <input
      {...rest}
      aria-invalid={accessibleInvalid}
      className={cn(FIELD_BASE, 'h-11 md:h-[34px]', invalid && 'border-[var(--danger)]', className)}
    />
  )
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea {...rest} className={cn(FIELD_BASE, 'py-2 leading-relaxed resize-y', className)} />
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return (
    <div className="relative">
      <select
        {...rest}
        className={cn(FIELD_BASE, 'h-11 cursor-pointer appearance-none pr-7 md:h-[34px]', className)}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 12 12"
        width="11"
        height="11"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
        aria-hidden="true"
      >
        <path
          d="M2.5 4.5 6 8l3.5-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}


export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] md:h-[20px] md:w-[34px]',
        'disabled:opacity-45',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-[2px] top-[2px] size-5 rounded-full bg-white shadow-sm md:size-[16px]',
          'transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]',
          checked ? 'translate-x-5 md:translate-x-[14px]' : 'translate-x-0',
        )}
      />
    </button>
  )
}


export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
  combo?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  disabled = false,
  className,
  label,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
  label?: string
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-required'?: boolean
}) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])
  const hasActiveOption = options.some((option) => option.value === value)
  const move = (index: number, key: string) => {
    if (!options.length) return
    let next = index
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (index + 1) % options.length
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (index - 1 + options.length) % options.length
    else if (key === 'Home') next = 0
    else if (key === 'End') next = options.length - 1
    else return
    onChange(options[next]!.value)
    buttonsRef.current[next]?.focus()
  }
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-required={ariaRequired}
      aria-disabled={disabled || undefined}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-[var(--r-md)] bg-[var(--bg-inset)] p-[3px]',
        'border border-[var(--border-subtle)]',
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value
        const button = (
          <button
            ref={(element) => {
              buttonsRef.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.title}
            disabled={disabled}
            tabIndex={active || (!hasActiveOption && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              move(index, event.key)
            }}
            className={cn(
              'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-[var(--r-sm)] font-medium',
              'transition-[color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
              'disabled:pointer-events-none disabled:opacity-45',
              size === 'sm' ? 'h-8 px-2.5 text-[11.5px] md:h-[22px] md:px-2' : 'h-9 px-3 text-[12.5px] md:h-[26px] md:px-2.5',
              active
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,.10)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            {option.label}
          </button>
        )
        return option.title ? (
          <Tooltip key={option.value} label={option.title} combo={option.combo}>
            {button}
          </Tooltip>
        ) : (
          <span key={option.value} className="contents">{button}</span>
        )
      })}
    </div>
  )
}


export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
  className,
  label,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  suffix?: string
  className?: string
  label?: string
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-required'?: boolean
}) {
  const range = max - min
  const rawPct = range > 0 && Number.isFinite(value) ? ((value - min) / range) * 100 : 0
  const pct = Math.min(100, Math.max(0, rawPct))
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <input
        id={id}
        type="range"
        aria-label={label}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired}
        aria-valuetext={`${value}${suffix ?? ''}`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ink-slider h-[18px] flex-1 cursor-pointer appearance-none bg-transparent"
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
      />
      <span className="w-11 shrink-0 text-right text-[12px] tabular text-[var(--text-tertiary)]">
        {value}
        {suffix}
      </span>
    </div>
  )
}


export function Field({
  label,
  hint,
  children,
  className,
  required,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
  required?: boolean
}) {
  const id = useId()
  const labelId = `${id}-label`
  const hintId = hint ? `${id}-hint` : undefined
  let controlId = `${id}-control`
  let control = children
  if (isValidElement<{
    id?: string
    'aria-labelledby'?: string
    'aria-describedby'?: string
    'aria-required'?: boolean
  }>(children)) {
    controlId = children.props.id ?? controlId
    const existingDescription = children.props['aria-describedby']
    control = cloneElement(children, {
      id: controlId,
      'aria-labelledby': children.props['aria-labelledby'] ?? labelId,
      'aria-describedby': [existingDescription, hintId].filter(Boolean).join(' ') || undefined,
      'aria-required': children.props['aria-required'] ?? (required || undefined),
    })
  }
  return (
    <div className={cn('space-y-1.5', className)}>
      <label id={labelId} htmlFor={controlId} className="block text-[12px] font-medium text-[var(--text-secondary)]">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-[var(--danger)]">*</span>}
      </label>
      <div>{control}</div>
      {hint && <p id={hintId} className="text-[11.5px] leading-relaxed text-[var(--text-quaternary)]">{hint}</p>}
    </div>
  )
}

export function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'setting-row flex flex-col items-stretch justify-between gap-2 py-3 md:flex-row md:items-center md:gap-6',
        'border-b border-[var(--border-subtle)] last:border-b-0',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{title}</div>
        {description && (
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-0 shrink-0">{children}</div>
    </div>
  )
}


export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('inline-flex min-h-10 items-center gap-2 text-[13px] md:min-h-0', className)}
    >
      <span
        className={cn(
          'inline-flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-[var(--dur-fast)]',
          checked
            ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]'
            : 'border-[var(--border-strong)] bg-[var(--bg-inset)]',
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      {label && <span className="text-[var(--text-secondary)]">{label}</span>}
    </button>
  )
}

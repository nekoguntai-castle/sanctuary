import React, { type CSSProperties, type MouseEventHandler, type RefObject } from 'react';
import { Lock, Mail, User, type LucideIcon } from 'lucide-react';

const FIELD_INPUT_CLASS =
  'appearance-none rounded-md block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors';

const PASSWORD_PLACEHOLDER = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

interface TextInputFieldProps {
  id: string;
  label: string;
  type: string;
  value: string;
  icon: LucideIcon;
  placeholder: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
  tabIndex?: number;
  children?: React.ReactNode;
}

const getRevealStyle = (isVisible: boolean): CSSProperties => ({
  gridTemplateRows: isVisible ? '1fr' : '0fr',
  opacity: isVisible ? 1 : 0,
});

const TextInputField: React.FC<TextInputFieldProps> = ({
  id,
  label,
  type,
  value,
  icon: Icon,
  placeholder,
  onChange,
  required,
  minLength,
  tabIndex,
  children,
}) => (
  <div className="input-ripple">
    <label htmlFor={id} className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">{label}</label>
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Icon className="h-4 w-4 text-sanctuary-400" />
      </div>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_INPUT_CLASS}
        placeholder={placeholder}
        minLength={minLength}
        tabIndex={tabIndex}
      />
    </div>
    {children}
  </div>
);

interface EmailFieldProps {
  isRegisterMode: boolean;
  email: string;
  onEmailChange: (value: string) => void;
}

const EmailField: React.FC<EmailFieldProps> = ({ isRegisterMode, email, onEmailChange }) => (
  <div
    className="grid transition-all duration-400 ease-in-out"
    style={getRevealStyle(isRegisterMode)}
  >
    <div className="overflow-hidden">
      <TextInputField
        id="email"
        label="Email (Optional)"
        type="email"
        value={email}
        icon={Mail}
        placeholder="your@email.com"
        onChange={onEmailChange}
        tabIndex={isRegisterMode ? 0 : -1}
      />
    </div>
  </div>
);

interface PasswordFieldProps {
  isRegisterMode: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
}

const PasswordField: React.FC<PasswordFieldProps> = ({
  isRegisterMode,
  password,
  onPasswordChange,
}) => (
  <TextInputField
    id="password"
    label="Password"
    type="password"
    required
    value={password}
    icon={Lock}
    placeholder={PASSWORD_PLACEHOLDER}
    minLength={8}
    onChange={onPasswordChange}
  >
    <PasswordHint isRegisterMode={isRegisterMode} />
  </TextInputField>
);

const PasswordHint: React.FC<{ isRegisterMode: boolean }> = ({ isRegisterMode }) => (
  <div
    className="grid transition-all duration-300 ease-in-out"
    style={getRevealStyle(isRegisterMode)}
  >
    <div className="overflow-hidden">
      <p className="mt-1 text-xs text-sanctuary-400 dark:text-sanctuary-600">
        Minimum 8 characters
      </p>
    </div>
  </div>
);

interface LoginFormFieldsProps {
  cardRef: RefObject<HTMLDivElement | null>;
  onCardMouseMove: MouseEventHandler<HTMLDivElement>;
  onCardMouseLeave: MouseEventHandler<HTMLDivElement>;
  isRegisterMode: boolean;
  username: string;
  password: string;
  email: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onEmailChange: (value: string) => void;
}

export const LoginFormFields: React.FC<LoginFormFieldsProps> = ({
  cardRef,
  onCardMouseMove,
  onCardMouseLeave,
  isRegisterMode,
  username,
  password,
  email,
  onUsernameChange,
  onPasswordChange,
  onEmailChange,
}) => (
  <div
    ref={cardRef}
    data-testid="login-card"
    onMouseMove={onCardMouseMove}
    onMouseLeave={onCardMouseLeave}
    className="rounded-xl surface-glass shadow-sm p-6 space-y-4 transition-[transform] duration-200 ease-out will-change-transform"
  >
    <TextInputField
      id="username"
      label="Username"
      type="text"
      required
      value={username}
      icon={User}
      placeholder="Enter username"
      onChange={onUsernameChange}
    />

    <EmailField
      isRegisterMode={isRegisterMode}
      email={email}
      onEmailChange={onEmailChange}
    />

    <PasswordField
      isRegisterMode={isRegisterMode}
      password={password}
      onPasswordChange={onPasswordChange}
    />
  </div>
);

import { Link, type LinkProps } from 'react-router-dom';
import { getButtonClassName, type ButtonSize, type ButtonVariant } from './Button';

interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function LinkButton({
  children,
  className = '',
  variant = 'secondary',
  size = 'sm',
  ...props
}: LinkButtonProps) {
  return (
    <Link {...props} className={getButtonClassName({ variant, size, className })}>
      {children}
    </Link>
  );
}

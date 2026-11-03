import type { ComponentProps } from 'react';

const SIZES = {
  small: 'text-12/[1.6]',
  normal: 'text-13/[1.6]',
  large: 'text-14/[1.6]',
};

interface HintProps extends ComponentProps<'p'> {
  size?: keyof typeof SIZES;
}

export function Hint({ size = 'normal', className = '', ...props }: HintProps) {
  return <p className={`my-3 text-muted ${SIZES[size]} ${className}`} {...props} />;
}

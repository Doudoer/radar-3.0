import React from 'react';

interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: number | string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, className = '', style, ...rest }) => (
  <span
    {...rest}
    aria-hidden="true"
    className={`material-symbols-outlined ${className}`}
    style={{ fontSize: typeof size === 'number' ? `${size}px` : size, ...style }}
  >
    {name}
  </span>
);

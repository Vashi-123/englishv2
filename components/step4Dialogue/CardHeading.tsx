import React from 'react';

type Props = {
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function CardHeading({ icon, className, children }: Props) {
  const base = 'flex items-center gap-2 text-xs uppercase font-semibold tracking-widest text-gray-500';
  const cls = className ? `${base} ${className}` : base;
  return (
    <div className={cls}>
      {icon}
      {children}
    </div>
  );
}


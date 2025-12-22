import React from 'react';

export const ModuleSeparatorHeading: React.FC<{ title: string }> = ({ title }) => (
  <div className="w-full flex items-center justify-center my-8">
    <div className="h-px bg-brand-primary/25 w-12 sm:w-20 rounded-full"></div>
    <span className="mx-4 text-[11px] font-bold text-brand-primary/80 uppercase tracking-widest">{title}</span>
    <div className="h-px bg-brand-primary/25 w-12 sm:w-20 rounded-full"></div>
  </div>
);

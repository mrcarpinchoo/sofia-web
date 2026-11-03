import type { ReactNode } from 'react';

interface SectionProps {
  number: string;
  title: string;
  id?: string;
  children: ReactNode;
}

export function Section({ number, title, id, children }: SectionProps) {
  return (
    <section
      id={id}
      className="border-b border-line px-5.5 pt-4.5 pb-5.5 phone:border-b-0 phone:px-4 phone:pt-3.5 phone:pb-5"
    >
      <h2 className="mb-4.5 text-16 font-semibold phone:mb-3">
        <span className="mr-2.25 font-mono text-12 text-[#718299]">{number}</span> {title}
      </h2>
      {children}
    </section>
  );
}

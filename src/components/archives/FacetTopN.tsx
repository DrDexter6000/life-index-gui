import type { DashboardFacetValue } from '@/lib/api-client';

export interface FacetTopNProps {
  facet: 'topics' | 'tags' | 'people';
  title: string;
  items: DashboardFacetValue[];
  emptyLabel: string;
}
/** Present canonical facet frequencies as read-only values. */
export function FacetTopN({ facet, title, items, emptyLabel }: FacetTopNProps) {
  return (
    <section
      data-testid={`archives-facet-${facet}`}
      aria-label={title}
      className="li-panel-card rounded-[24px] p-6"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="li-panel-title text-[1rem]">{title}</h2>
        <span className="li-panel-kicker">Top {items.length}</span>
      </div>
      {items.length === 0 ? (
        <p data-testid={`archives-facet-${facet}-empty`} className="li-panel-copy">{emptyLabel}</p>
      ) : (
        <ol className="space-y-2" aria-label={title}>
          {items.map((item) => {
            const label = (
              <span className="min-w-0 truncate" title={item.value}>{item.value}</span>
            );
            return (
              <li key={`${item.value}-${item.count}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1">{label}</span>
                <span data-testid={`archives-facet-${facet}-count-${item.value}`} className="shrink-0 text-[var(--color-cyan)]">
                  {item.count}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

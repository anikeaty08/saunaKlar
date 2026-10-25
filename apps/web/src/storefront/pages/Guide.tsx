import { useT } from '../../i18n/i18n.ts';
import { Reveal } from '../../motion/Reveal.tsx';
import { SectionHeading } from '../../design/components/SectionHeading.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHero } from '../components/PageHero.tsx';
import { SaunaGlyph } from '../components/SaunaGlyph.tsx';
import './Content.css';

const WOOD_SWATCH = ['#dcc39b', '#c48d5e', '#a8774a', '#8d7a66'];

export default function Guide() {
  const { t, m } = useT();
  useDocumentTitle(t('guide.eyebrow'));
  const g = m.guide;
  return (
    <div className="page container">
      <PageHero eyebrow={t('guide.eyebrow')} title={t('guide.title')} lede={t('guide.lede')} />

      <section className="section">
        <SectionHeading index="01" title={g.sizeTitle} lede={g.sizeBody} size="md" />
        <div className="guide-sizes">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{g.sizeColumns.persons}</th>
                <th scope="col">{g.sizeColumns.size}</th>
                <th scope="col">{g.sizeColumns.note}</th>
              </tr>
            </thead>
            <tbody>
              {g.sizeTable.map(r => (
                <tr key={r.persons}>
                  <td className="mono">{r.persons}</td>
                  <td className="mono">{r.size}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="guide-sizes__art" aria-hidden="true">
            {[1200, 1600, 2000, 2400].map(w => (
              <SaunaGlyph key={w} form="box" widthMm={w} depthMm={w} heightMm={2100} />
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHeading index="02" title={g.heaterTitle} lede={g.heaterRule} size="md" />
        <Reveal as="ul" className="cards-3">
          {g.heaters.map(h => (
            <li key={h.title}>
              <h3>{h.title}</h3>
              <p>{h.body}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <section className="section">
        <SectionHeading index="03" title={g.woodTitle} size="md" />
        <Reveal as="ul" className="woods">
          {g.woods.map((w, i) => (
            <li key={w.title}>
              <span className="woods__swatch" style={{ background: WOOD_SWATCH[i] }} aria-hidden="true" />
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <section className="section">
        <SectionHeading index="04" title={g.careTitle} lede={g.care} size="md" />
      </section>
    </div>
  );
}

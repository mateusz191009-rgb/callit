/**
 * THE THEMED CATEGORY SCENES — parked, not deleted (v25.18).
 *
 * Every built-in category had its own animated hero: the crypto price
 * constellation, the esports broadcast overlay, the politics tally board, the
 * arena-night scenes for tennis / UFC / cricket / motorsport, and so on. The
 * hub route stopped mounting them because of what they cost the page rather
 * than what they are: hero (~280px) + sport chips + the Top-contenders panel
 * (~350px) put roughly 680px of chrome above the first market card, so a 1080p
 * screen showed ZERO cards without scrolling where Polymarket shows nine.
 *
 * Owner: "unsere kategorie seiten vielleicht not too much siehe polymarket die
 * haben nicht so auf falende heroes etc" — and then, explicitly: keep them,
 * don't delete them.
 *
 * So this file is the wiring, preserved intact. NOTHING IMPORTS IT, which means
 * it costs nothing at runtime (the bundler drops the whole graph), and bringing
 * a scene back is an import plus a lookup in app/category/[cat]/page.tsx:
 *
 *   const Hero = SPORT_HEROES[sport] ?? THEMED_HEROES[category] ?? CustomHero;
 *   <Hero markets={…} events={…} stats={heroStats} fallback={<GenericHero …/>} />
 *
 * Each scene renders `fallback` itself when its category has fewer than 3
 * usable markets, so GenericHero (components/category/GenericHero.tsx) has to
 * come along for the ride.
 */

import type { SportKey } from '@/lib/sports';
import type { CategoryHeroProps } from './CryptoHero';
import BaseballHero from './BaseballHero';
import BasketballHero from './BasketballHero';
import CricketHero from './CricketHero';
import CryptoHero from './CryptoHero';
import CustomHero from './CustomHero';
import EconomyHero from './EconomyHero';
import EsportsHero from './EsportsHero';
import FootballHero from './FootballHero';
import MotorsportHero from './MotorsportHero';
import PoliticsHero from './PoliticsHero';
import PopCultureHero from './PopCultureHero';
import SportsHero from './SportsHero';
import TechScienceHero from './TechScienceHero';
import TennisHero from './TennisHero';
import UfcHero from './UfcHero';
import WorldHero from './WorldHero';

/** One themed scene per built-in category. Admin-created custom slugs are not
 *  in this map and resolve to CustomHero — its "anything you can imagine" idea
 *  network is exactly right for a user-invented category. */
export const THEMED_HEROES: Record<string, React.ComponentType<CategoryHeroProps>> = {
  politics: PoliticsHero,
  sports: SportsHero,
  football: FootballHero,
  basketball: BasketballHero,
  baseball: BaseballHero,
  esports: EsportsHero,
  crypto: CryptoHero,
  economy: EconomyHero,
  'tech-science': TechScienceHero,
  world: WorldHero,
  'pop-culture': PopCultureHero,
  custom: CustomHero,
};

/** v25.7 — inside the Sports hub the active sport chip picked the scene.
 *  Sports without one of their own kept the hub's generic SportsHero: an
 *  obviously-generic scene reads as a missing feature, a wrong one as a bug. */
export const SPORT_HEROES: Partial<Record<SportKey, React.ComponentType<CategoryHeroProps>>> = {
  soccer: FootballHero,
  basketball: BasketballHero,
  baseball: BaseballHero,
  tennis: TennisHero,
  ufc: UfcHero,
  cricket: CricketHero,
  motorsport: MotorsportHero,
};

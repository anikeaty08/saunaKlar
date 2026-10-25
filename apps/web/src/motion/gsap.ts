/**
 * The one place GSAP plugins are registered. Import gsap and plugins from here
 * so registration always happened before use.
 */
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP, ScrambleTextPlugin, SplitText, Flip, ScrollTrigger, ScrollToPlugin, CustomEase);

/** House easings: a long, confident deceleration and a symmetric in-out. */
CustomEase.create('sk.out', 'M0,0 C0.16,1 0.3,1 1,1');
CustomEase.create('sk.inOut', 'M0,0 C0.65,0 0.35,1 1,1');
CustomEase.create('sk.snap', 'M0,0 C0.625,0.05 0,1 1,1');
CustomEase.create('sk.outSoft', 'M0,0 C0.22,1 0.36,1 1,1');

gsap.defaults({ ease: 'sk.out', duration: 0.8 });
ScrollTrigger.config({ ignoreMobileResize: true });

/** Glyphs used for the "noisy letters" scramble. */
export const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#*+=<>';
export const SCRAMBLE_DIGITS = '0123456789';

export { gsap, CustomEase, Flip, ScrambleTextPlugin, ScrollToPlugin, ScrollTrigger, SplitText, useGSAP };

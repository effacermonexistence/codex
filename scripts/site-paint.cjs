'use strict';
// One source-preserving English paint path shared by serving and locale extraction.
const {withRootCanvas}=require('./root-canvas.cjs');
const {withHistoryFooter,releaseDate}=require('./site-history-footer.cjs');
const {withSharedFooter}=require('./site-shared-footer.cjs');
function createSitePaint(root){
 const interactionPolicy=require('./interaction-motion.cjs').interactionMotion(root);
 const compactMenu=require('./compact-navigation.cjs').compactNavigation(root);
 const recoveredSections=require('./section-recovery.cjs').sectionRecovery(root,interactionPolicy.markup);
 const applicationAppearance=require('./apply-appearance.cjs').applyAppearance(root);
 const bodyWordmarkPolicy=require('./body-wordmarks.cjs').bodyWordmarks(root);
 const homepageMotion=require('./home-motion-performance.cjs').homeMotionPerformance(root);
 const textSizePolicy=require('./site-typography.cjs').siteTypography(root);
 const textVeilPolicy=require('./text-veil.cjs').textVeil(root);
 const tattooShapePolicy=require('./tattoo-legibility.cjs').tattooLegibility(root);
 const sectionHeadingPolicy=require('./section-identity.cjs').sectionIdentity(root,bodyWordmarkPolicy);
 const landingRhythmPolicy=require('./landing-rhythm.cjs').landingRhythm(root);
 const brandAnchorPolicy=require('./body-brand-anchor.cjs').bodyBrandAnchor(root);
 const date=releaseDate(root);
 return{homepageMotion,tattooShapePolicy,render(raw,route){
  let html=withRootCanvas(raw);html=withSharedFooter(html,route,root);html=withHistoryFooter(html,route,date);
  html=compactMenu.render(html,route);html=interactionPolicy.render(html);html=recoveredSections.render(html,route);
  html=applicationAppearance.render(html,route);html=bodyWordmarkPolicy.render(html,route);html=homepageMotion.render(html,route);
  html=textSizePolicy.render(html,route);html=textVeilPolicy.render(html,route);html=tattooShapePolicy.render(html,route);
  html=sectionHeadingPolicy.render(html,route);html=landingRhythmPolicy.render(html,route);return brandAnchorPolicy.render(html,route);
 }};
}
module.exports={createSitePaint};

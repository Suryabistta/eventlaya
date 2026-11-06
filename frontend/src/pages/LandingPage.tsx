import React from 'react'
import { MotionConfig } from 'framer-motion'
import { Hero } from './landing/Hero'
import { ProductTour } from './landing/ProductTour'
import { EventKindsStrip, HowItWorks, FeatureGrid, NumbersBand, MarketplaceBand, PricingTeaser, Faq, FinalCta } from './landing/Sections'

export { GatePassDemo } from './landing/GatePass'

export const LandingPage: React.FC = () => (
  // Respect the visitor's reduced-motion setting for every animation on the page
  <MotionConfig reducedMotion="user">
    <Hero />
    <EventKindsStrip />
    <ProductTour />
    <HowItWorks />
    <NumbersBand />
    <FeatureGrid />
    <MarketplaceBand />
    <PricingTeaser />
    <Faq />
    <FinalCta />
  </MotionConfig>
)

export default LandingPage

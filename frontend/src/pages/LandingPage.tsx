import React from 'react'
import { MotionConfig } from 'framer-motion'
import { Hero } from './landing/Hero'
import { ProductTour } from './landing/ProductTour'
import { Faq } from './landing/Sections'
import { ContactSection, EventsShowcase, FeaturesEight, Partners, PoweredBy, SearchHero, StepsTabs, Testimonials, VendorsShowcase } from './landing/Discover'

export { GatePassDemo } from './landing/GatePass'

export const LandingPage: React.FC = () => (
  // Respect the visitor's reduced-motion setting for every animation on the page
  <MotionConfig reducedMotion="user">
    <SearchHero />
    <Hero />
    <EventsShowcase />
    <VendorsShowcase />
    <FeaturesEight />
    <ProductTour />
    <Testimonials />
    <Partners />
    <PoweredBy />
    <StepsTabs />
    <Faq />
    <ContactSection />
  </MotionConfig>
)

export default LandingPage

export const SEED_ADMIN = {
  name: 'Admin',
  // Codes are e-mailed at login, so use a REAL inbox in production: SEED_ADMIN_EMAIL=you@yourdomain.com
  email: (process.env.SEED_ADMIN_EMAIL ?? 'ah59642@gmail.com').toLowerCase(),
  role: 'super_admin' as const,
};

export const SEED_CATEGORIES = [
  { name: 'Skincare', description: 'Cleansers, serums, moisturizers and more' },
  { name: 'Makeup', description: 'Face, eyes, lips and complexion products' },
  { name: 'Hair Care', description: 'Shampoo, conditioner, styling and treatments' },
  { name: 'Fragrance', description: 'Perfumes and body mists' },
  { name: 'Bath & Body', description: 'Body wash, lotions, scrubs' },
];

export const SEED_BRANDS = [
  { name: 'Lumière', description: 'Premium French-inspired skincare' },
  { name: 'VelvetGlow', description: 'Modern minimal makeup essentials' },
  { name: 'Aurelia', description: 'Luxury fragrance house' },
  { name: 'PureLeaf', description: 'Clean, botanical-based formulas' },
];

export const SEED_ATTRIBUTES = [
  {
    name: 'Skin Type',
    type: 'multiselect' as const,
    predefined_values: ['Oily', 'Dry', 'Combination', 'Sensitive', 'Normal'],
    is_required: false,
    is_filterable: true,
    is_visible: true,
    applies_to: 'product' as const,
  },
  {
    name: 'Volume',
    type: 'measurement' as const,
    predefined_values: [],
    is_required: false,
    is_filterable: false,
    is_visible: true,
    applies_to: 'both' as const,
  },
  {
    name: 'Shade',
    type: 'color' as const,
    predefined_values: [],
    is_required: false,
    is_filterable: true,
    is_visible: true,
    applies_to: 'variant' as const,
  },
  {
    name: 'Cruelty Free',
    type: 'boolean' as const,
    predefined_values: [],
    is_required: false,
    is_filterable: true,
    is_visible: true,
    applies_to: 'product' as const,
  },
];

export interface SeedProductInput {
  name: string;
  categoryName: string;
  brandName: string | null;
  shortDescription: string;
  fullDescription: string;
  basePrice: number;
  salePrice: number | null;
  isFeatured: boolean;
  isNewArrival: boolean;
  isOffer: boolean;
}

export const SEED_PRODUCTS: SeedProductInput[] = [
  {
    name: 'Hydrating Rose Cleanser',
    categoryName: 'Skincare',
    brandName: 'Lumière',
    shortDescription: 'Gentle gel cleanser with rose water and hyaluronic acid.',
    fullDescription:
      'A soap-free daily cleanser formulated with rose water and hyaluronic acid to remove impurities while maintaining skin moisture balance. Suitable for all skin types.',
    basePrice: 24.0,
    salePrice: 19.99,
    isFeatured: true,
    isNewArrival: false,
    isOffer: true,
  },
  {
    name: 'Vitamin C Brightening Serum',
    categoryName: 'Skincare',
    brandName: 'PureLeaf',
    shortDescription: '15% Vitamin C serum for radiant, even-toned skin.',
    fullDescription:
      'A potent antioxidant serum combining stabilized Vitamin C, ferulic acid, and vitamin E to brighten skin tone and defend against environmental stressors.',
    basePrice: 38.5,
    salePrice: null,
    isFeatured: true,
    isNewArrival: true,
    isOffer: false,
  },
  {
    name: 'Velvet Matte Lipstick',
    categoryName: 'Makeup',
    brandName: 'VelvetGlow',
    shortDescription: 'Long-wear matte lipstick in a soft velvet finish.',
    fullDescription:
      'A comfortable, long-lasting matte lipstick with a lightweight feel and rich pigment payoff. Available in multiple shades.',
    basePrice: 18.0,
    salePrice: null,
    isFeatured: false,
    isNewArrival: true,
    isOffer: false,
  },
  {
    name: 'Silk Foundation SPF 30',
    categoryName: 'Makeup',
    brandName: 'VelvetGlow',
    shortDescription: 'Buildable medium coverage foundation with SPF 30.',
    fullDescription:
      'A silky, buildable foundation that evens out skin tone while providing SPF 30 protection. Natural satin finish that photographs beautifully.',
    basePrice: 32.0,
    salePrice: 27.99,
    isFeatured: true,
    isNewArrival: false,
    isOffer: true,
  },
  {
    name: 'Argan Repair Hair Mask',
    categoryName: 'Hair Care',
    brandName: 'PureLeaf',
    shortDescription: 'Deep conditioning mask with argan oil for damaged hair.',
    fullDescription:
      'An intensive weekly treatment mask enriched with argan oil and keratin proteins to repair damaged, dry, or color-treated hair.',
    basePrice: 22.0,
    salePrice: null,
    isFeatured: false,
    isNewArrival: false,
    isOffer: false,
  },
  {
    name: 'Aurelia Nocturne Eau de Parfum',
    categoryName: 'Fragrance',
    brandName: 'Aurelia',
    shortDescription: 'A warm, woody evening fragrance.',
    fullDescription:
      'Notes of amber, sandalwood, and dark vanilla create a sophisticated evening scent that lingers elegantly through the night.',
    basePrice: 89.0,
    salePrice: null,
    isFeatured: true,
    isNewArrival: true,
    isOffer: false,
  },
  {
    name: 'Whipped Shea Body Butter',
    categoryName: 'Bath & Body',
    brandName: 'PureLeaf',
    shortDescription: 'Ultra-rich whipped body butter with shea and cocoa.',
    fullDescription:
      'A luxuriously thick body butter whipped with shea butter and cocoa butter to deeply moisturize dry skin, leaving it soft without greasy residue.',
    basePrice: 16.5,
    salePrice: 13.99,
    isFeatured: false,
    isNewArrival: false,
    isOffer: true,
  },
  {
    name: 'Charcoal Detox Face Mask',
    categoryName: 'Skincare',
    brandName: 'Lumière',
    shortDescription: 'Purifying clay and charcoal mask for congested skin.',
    fullDescription:
      'A deep-cleansing mask combining activated charcoal and kaolin clay to draw out impurities and minimize the appearance of pores.',
    basePrice: 21.0,
    salePrice: null,
    isFeatured: false,
    isNewArrival: true,
    isOffer: false,
  },
];

export const SEED_HOMEPAGE_SECTIONS = [
  {
    type: 'hero' as const,
    title: 'Radiance, Redefined',
    subtitle: 'Discover premium cosmetics crafted for your everyday glow.',
    button_text: 'Shop Now',
    button_link: '/shop',
    sort_order: 1,
  },
  {
    type: 'offer' as const,
    title: 'Up to 25% Off Bestsellers',
    subtitle: 'Limited-time offers on skincare and makeup favorites.',
    button_text: 'View Offers',
    button_link: '/shop?isOffer=true',
    sort_order: 2,
  },
  {
    type: 'new_arrival' as const,
    title: 'Just Landed',
    subtitle: 'The newest additions to the SleeknShine collection.',
    button_text: 'See New Arrivals',
    button_link: '/shop?isNewArrival=true',
    sort_order: 3,
  },
  {
    type: 'featured_category' as const,
    title: 'Shop by Category',
    subtitle: 'Find exactly what your routine needs.',
    sort_order: 4,
  },
];

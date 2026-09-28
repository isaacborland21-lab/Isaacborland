// The starting meal plan. Once you edit any slot on the site, your edited
// plan is saved to the database and this file is only used by "Reset".

export type Batch = "Sunday prep" | "Wednesday prep" | "Cook fresh";
export const BATCHES: Batch[] = ["Sunday prep", "Wednesday prep", "Cook fresh"];

export type PlanMeal = {
  day: string;
  name: string;
  note: string;
  batch: Batch;
  recipeId?: string; // linked saved recipe; its ingredients feed the grocery list
  ingredients?: string; // one per line; used when no recipe is linked
};

export type MealPlanData = { lunch: PlanMeal[]; dinner: PlanMeal[] };

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const L = (...items: string[]) => items.join("\n");

export const DEFAULT_PLAN: MealPlanData = {
  lunch: [
    { day: "Mon", name: "Cilantro-lime chicken burrito bowls", note: "Rice, black beans, corn salsa, chicken.", batch: "Sunday prep",
      ingredients: L("1.5 lb chicken breast", "1 cup rice", "1 can black beans", "1 cup corn", "2 lime", "1 bunch cilantro", "1 jar salsa") },
    { day: "Tue", name: "Greek chicken quinoa bowls", note: "Cucumber, tomato, feta. Tzatziki on the side so it stays crisp.", batch: "Sunday prep",
      ingredients: L("1.5 lb chicken breast", "1 cup quinoa", "1 cucumber", "1 pint cherry tomatoes", "4 oz feta", "1 container tzatziki") },
    { day: "Wed", name: "Beef & broccoli with rice", note: "Keep the sauce thick so the rice doesn't go soggy.", batch: "Sunday prep",
      ingredients: L("1 lb flank steak", "2 head broccoli", "1 cup rice", "1/2 cup soy sauce", "3 clove garlic", "1 tbsp cornstarch") },
    { day: "Thu", name: "Pesto chicken pasta salad", note: "Eat cold. Cherry tomatoes, mozzarella, spinach.", batch: "Wednesday prep",
      ingredients: L("1 lb chicken breast", "1 lb rotini pasta", "1 jar pesto", "1 pint cherry tomatoes", "8 oz mozzarella pearls", "1 bag spinach") },
    { day: "Fri", name: "Peanut chicken noodles", note: "Rice noodles, shredded carrot, cabbage. Cold or warm.", batch: "Wednesday prep",
      ingredients: L("1 lb chicken breast", "8 oz rice noodles", "1/2 cup peanut butter", "1/4 cup soy sauce", "2 carrot", "1/2 head red cabbage") },
    { day: "Sat", name: "Turkey chili", note: "Big pot. Freeze the extra portions for next week.", batch: "Wednesday prep",
      ingredients: L("1 lb ground turkey", "1 can kidney beans", "1 can black beans", "1 can diced tomatoes", "1 onion", "2 tbsp chili powder") },
    { day: "Sun", name: "BBQ pulled pork sweet potato bowls", note: "Freeze Wednesday, move to fridge Saturday night.", batch: "Wednesday prep",
      ingredients: L("2 lb pork shoulder", "1 cup bbq sauce", "3 sweet potato", "1 bag coleslaw mix") },
  ],
  dinner: [
    { day: "Mon", name: "Sheet-pan sausage, peppers & potatoes", note: "One pan, 35 min. Portion into containers.", batch: "Sunday prep",
      ingredients: L("1 lb smoked sausage", "2 bell pepper", "1.5 lb baby potatoes", "1 onion", "2 tbsp olive oil") },
    { day: "Tue", name: "Slow-cooker chicken tikka masala", note: "Serve over rice. Better on day 2.", batch: "Sunday prep",
      ingredients: L("2 lb chicken thighs", "1 jar tikka masala sauce", "1 cup rice", "1 onion", "1/2 cup plain yogurt") },
    { day: "Wed", name: "Baked ziti", note: "Assemble Sunday, keep unbaked in the fridge, bake Wednesday night.", batch: "Sunday prep",
      ingredients: L("1 lb ziti pasta", "1 lb ground beef", "1 jar marinara", "15 oz ricotta", "8 oz shredded mozzarella") },
    { day: "Thu", name: "Honey-garlic chicken & green beans", note: "Cook Wednesday, reheats well. Serve with rice.", batch: "Wednesday prep",
      ingredients: L("2 lb chicken thighs", "1/3 cup honey", "1/4 cup soy sauce", "4 clove garlic", "1 lb green beans", "1 cup rice") },
    { day: "Fri", name: "Steak fajitas", note: "Slice peppers & onions, marinate steak Wednesday. 15 min to cook Friday.", batch: "Wednesday prep",
      ingredients: L("1.5 lb flank steak", "3 bell pepper", "1 onion", "8 flour tortillas", "2 lime", "1 packet fajita seasoning") },
    { day: "Sat", name: "Shepherd's pie", note: "Assemble Wednesday, bake Saturday.", batch: "Wednesday prep",
      ingredients: L("1.5 lb ground beef", "1 bag frozen peas & carrots", "2 lb russet potatoes", "1/2 cup milk", "2 tbsp butter", "1 cup beef broth") },
    { day: "Sun", name: "Chicken enchiladas", note: "Assemble & freeze Wednesday. Thaw Saturday night, bake Sunday.", batch: "Wednesday prep",
      ingredients: L("1.5 lb chicken breast", "1 can enchilada sauce", "8 flour tortillas", "8 oz shredded cheddar", "1 can green chiles") },
  ],
};

const mealPlanRepository = require("../repositories/mealPlanRepository");

function getMealPlan(query) {
  return mealPlanRepository.listMealPlan(query);
}

function saveMealPlan(entries, options) {
  return mealPlanRepository.replaceMealPlan(entries, options);
}

module.exports = {
  getMealPlan,
  saveMealPlan
};

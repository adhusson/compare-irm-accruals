const Math = require("mathjs");
// Can lower precision to 64 to go faster
const M = Math.create(Math.all, {number:'BigNumber',precision:128});
const fs = require('fs');

// Constants

// Number of weeks to run for
const DURATION_IN_WEEKS = 10;
// Initial rate at target (per year)
const INITIAL_RATE = 2;

const YEAR = 365*24*60*60;
// Speed factor
const Kp = M.evaluate(`50/${YEAR}`);
// Rate at target adjustment factor
const Kd = 4;
// Rate at target at time 0
const R0 = M.evaluate(`${INITIAL_RATE}/${YEAR}`);
// Borrow at time 0
let B0 = M.evaluate('900000057077627380/1e18');
// Supply at time 0
let S0 = M.evaluate('1000000057077627380/1e18');
// Target utilization
const uTarget = M.evaluate('0.9');

// Compute interest accumulated by principal at given rate over given period
const interest = (principal,rate,period) => {
  return M.multiply(principal,M.expm1(M.multiply(rate,period)));
}

// curve in [1/Kd;Kd]
const KdMinus1 = M.evaluate(`${Kd} - 1`);
const curve = (err) => M.add(M.multiply(M.divide(KdMinus1,M.larger(err,0) ? 1 : Kd),err),1);

// Shift rate at target over curve according to error err
const rate = (rateAtTarget,err) => {
  return M.multiply(rateAtTarget,curve(err));
}

// Accrue interest in a market
const accrueInterest = (market,elapsed) => {
  const rate = borrowRate(market,elapsed);
  const interests = interest(market.borrow,rate,elapsed);
  market.borrow = M.add(market.borrow, interests);
  market.supply = M.add(market.supply, interests);
}

// Update borrow rate in a market
const borrowRate = (market,elapsed) => {
  const {avgBorrowRate,endRateAtTarget} = _borrowRate({...market},elapsed);
  market.rateAtTarget = endRateAtTarget;
  return avgBorrowRate;
}

// Compute borrow rate update in a market
const _borrowRate = ({borrow,supply,rateAtTarget:startRateAtTarget,initialUtilization},elapsed) => {
  const utilization = M.divide(borrow,supply);
  const errNormFactor = M.larger(utilization,uTarget) ? M.subtract(1,uTarget) : uTarget;
  const err = M.divide(M.subtract(utilization,uTarget),errNormFactor);
  const initialErrNormFactor = M.larger(initialUtilization,uTarget) ? M.subtract(1,uTarget) : uTarget;
  // Use initialErr instead of err to get a perfect match between regular accruals and a single accrual at the end
  const initialErr = M.divide(M.subtract(initialUtilization,uTarget),initialErrNormFactor);
  if (M.equal(startRateAtTarget,0)) {
    return { avgBorrowRate: rate(R0,err), endRateAtTarget: R0 };
  } else {
    const speed = M.multiply(Kp,err);
    const linearAdaptation = M.multiply(speed,elapsed);
    const adaptationMultiplier = M.exp(linearAdaptation);
    const endRateAtTarget = M.multiply(startRateAtTarget,adaptationMultiplier);

    const endBorrowRate = rate(endRateAtTarget,err);
    if (M.equal(linearAdaptation,0)) {
      return { avgBorrowRate: endBorrowRate, endRateAtTarget }
    } else {
      const startBorrowRate = rate(startRateAtTarget,err);
      const avgBorrowRate = M.divide(M.subtract(endBorrowRate,startBorrowRate),linearAdaptation);
      return {avgBorrowRate,endRateAtTarget};
    }
  }
}

// From weeks to seconds
const weeks = n => 3600*24*7*n;

// Run ~duration/period updates over duration every period on a fresh market.
// Return the market (& its total borrow history)
const runStep = (duration,period) => {
  duration = duration-(duration%period);
 
  const bperiod = M.bignumber(period);

  const market = {
    borrow: B0, // current total borrow
    supply: S0, // current total supply
    rateAtTarget: R0, // current rate at target
    time: 0, // current time
    borrows: [[0,B0]], // list of [time,total borrow] at each update time
    initialUtilization: M.divide(B0,S0) // remember initial utilization market life (not currently used)
  }

  for (let i = 0;i<duration/period;i++) {
    accrueInterest(market,bperiod);
    market.time += period;
    market.borrows.push([market.time,market.borrow]);
  }

  console.log(`B0,${duration},${period} | borrows`.padStart(30),market.borrow);
  return market;
}

// Compare two borrow increases
const compare = (n1,{borrow:b1},n2,{borrow:b2}) => {
  const b1Inc = M.subtract(b1,B0);
  const b2Inc = M.subtract(b2,B0);
  const incRatio = M.divide(M.multiply(b1Inc,100),b2Inc);
  console.log(`${n1}Δ/${n2}Δ`.padStart(30),incRatio,"%");
}

// Duration in seconds
let duration  = weeks(DURATION_IN_WEEKS);

// Run object to be serialized
const serializedRuns = {
  initialRate: `${INITIAL_RATE*100}%`,
  runs: {},
  baseRunName: "Full Duration"
};

// Create base curve "one accrue at the end of the period"
// One sample per week.
const baseRun = (() => {
  const mduration = runStep(weeks(1),weeks(1));
  const durationBorrows = [...mduration.borrows];
  for (let i = 1;i<=DURATION_IN_WEEKS;i++) {
    const unitRun = runStep(weeks(i),weeks(i));
    durationBorrows.push(unitRun.borrows.at(-1));
  }
  return durationBorrows;
})();


// Turn run into readable time series
const serializeRun = run => run.map(([t,v]) => {
  return {time:t,v:M.format(M.multiply(v,10000000),{notation:'fixed',precision:5})};
});

serializedRuns.runs[serializedRuns.baseRunName] = serializeRun(baseRun);

// Make a run that updates every period
const periodRun = (name,period) => {
  const run = runStep(duration,period);
  compare(name,run,"full",{borrow: baseRun.at(-1)[1]});
  serializedRuns.runs[name] = serializeRun(run.borrows);
}

  // const mborrow = {borrow: durationBorrows.at(-1)[1]};

periodRun('Every 1M seconds',1e6);
periodRun('Every 600k seconds',600e3);
periodRun('Every 200k seconds',200e3);
periodRun('Every 20k seconds',20e3);

fs.writeFileSync("./compounds.json",JSON.stringify(serializedRuns));
  
  
  // {
  // "Full duration": serializeCompounds(durationBorrows),
  // "Every 10M seconds": serializeCompounds(m10M.borrows),
  // "Every 1M seconds": serializeCompounds(m1M.borrows),
  // "Every 600k seconds": serializeCompounds(m600k.borrows),
  // "Every 200k seconds": serializeCompounds(m200k.borrows),
  // "Every 20k seconds": serializeCompounds(m20k.borrows),
  // "Every 1k seconds": serializeCompounds(m1k.borrows),
  // "Every 300 seconds": serializeCompounds(m300.borrows),
  // "Every 60 seconds": serializeCompounds(m60.borrows),
  // "Every 10 seconds": serializeCompounds(m10.borrows)
// }));





/* Not used
const trend = runStep(weeks(1),weeks(1)).borrows;
for (let i = 2;i<50;i++) {
  trend.push(runStep(weeks(i),weeks(i)).borrows.at(-1));
}

fs.writeFileSync("./trend.json",JSON.stringify({
  "sequence": serializeCompounds(trend)
}));
*/
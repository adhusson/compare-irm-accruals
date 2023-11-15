# Adapting ChatGPT's plotting code
import json
import matplotlib.pyplot as plt

with open('compounds.json', 'r') as file:
    json_data = json.load(file)

initial_rate = json_data['initialRate']
runs = json_data['runs']
base_run_key = json_data['baseRunName']

fig, ax = plt.subplots(figsize=(12, 6))

print(runs)
for key, sequence in runs.items():
  times = [item['time'] / 604800 for item in sequence]  # Convert time to weeks
  values = [float(item['v']) / 1e8 for item in sequence]  # Convert values to 1e8 units
  if key == base_run_key:
      # Highlighting the base run
      ax.plot(times, values, label=key, marker='o', zorder=5)
  else:
      # Other runs without markers
      ax.plot(times, values, label=key, linestyle='--')

ax.set_xlabel('Time (in weeks)')
ax.set_ylabel('Value')
ax.set_title(f'Comparing accrual freqs. Initial RateAtTarget: {initial_rate}')
ax.legend()
ax.grid(True)

plt.show()
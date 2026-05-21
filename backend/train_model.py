import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
import joblib
import os

def generate_synthetic_data(n_samples=2000):
    """
    Generate synthetic patient vital data for training the risk model.
    Features: [last_hr, last_spo2, last_temp, hr_delta, spo2_delta]
    """
    np.random.seed(42)
    
    # Base normal vitals
    hr = np.random.normal(75, 10, n_samples)
    spo2 = np.random.normal(97, 2, n_samples)
    temp = np.random.normal(36.8, 0.4, n_samples)
    hr_delta = np.random.normal(0, 3, n_samples)
    spo2_delta = np.random.normal(0, 1, n_samples)
    
    # Inject anomalies for high-risk cases (about 30% of data)
    n_anomalies = int(n_samples * 0.3)
    anomaly_idx = np.random.choice(n_samples, n_anomalies, replace=False)
    
    # Tachycardia / Bradycardia
    hr[anomaly_idx[:int(n_anomalies*0.4)]] = np.random.uniform(100, 140, int(n_anomalies*0.4))
    hr_delta[anomaly_idx[:int(n_anomalies*0.4)]] = np.random.uniform(10, 30, int(n_anomalies*0.4))
    
    hr[anomaly_idx[int(n_anomalies*0.4):int(n_anomalies*0.6)]] = np.random.uniform(30, 50, int(n_anomalies*0.2))
    
    # Hypoxia
    spo2[anomaly_idx[int(n_anomalies*0.6):int(n_anomalies*0.8)]] = np.random.uniform(80, 93, int(n_anomalies*0.2))
    spo2_delta[anomaly_idx[int(n_anomalies*0.6):int(n_anomalies*0.8)]] = np.random.uniform(-10, -3, int(n_anomalies*0.2))
    
    # Fever / Hypothermia
    temp[anomaly_idx[int(n_anomalies*0.8):]] = np.random.uniform(38.5, 41.0, int(n_anomalies*0.2))

    X = np.column_stack((hr, spo2, temp, hr_delta, spo2_delta))
    
    # Labels: 1 if ANY condition is met, else 0
    # Condition: HR > 95 or HR < 50 or SpO2 < 94 or Temp > 38.2 or (hr_delta > 15) or (spo2_delta < -3)
    y = ((hr > 95) | (hr < 50) | (spo2 < 94) | (temp > 38.2) | (hr_delta > 15) | (spo2_delta < -3)).astype(int)
    
    return X, y

if __name__ == "__main__":
    print("Generating synthetic patient dataset...")
    X, y = generate_synthetic_data(5000)
    
    print(f"Dataset shape: {X.shape}, High-risk cases: {sum(y)} ({sum(y)/len(y)*100:.1f}%)")
    
    # We use a Random Forest for non-linear thresholding, but Logistic Regression works too.
    # We'll use RandomForest for a more realistic multi-variable probability distribution.
    model = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
    
    print("Training ML Risk Model...")
    model.fit(X, y)
    
    model_path = os.path.join(os.path.dirname(__file__), "risk_model.pkl")
    joblib.dump(model, model_path)
    
    print(f"Model trained and saved to {model_path} ✓")

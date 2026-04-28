import React from 'react';

type TabType = 'overview' | 'models';

interface DashboardTabsProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

interface Tab {
  id: TabType;
  label: string;
}

const tabs: Tab[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'models', label: 'Modelle' }
];

export default function DashboardTabs({ activeTab, onTabChange }: DashboardTabsProps): React.ReactElement {
  return (
    <div className="flex gap-4 border-b border-gray-200">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-4 py-3 font-medium transition-all ${
            activeTab === tab.id
              ? 'text-gray-900 border-b-2 border-gray-900'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DashboardTabs from '../DashboardTabs';

describe('DashboardTabs', () => {
  it('renders two tabs: Übersicht and Modelle', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    expect(screen.getByText('Übersicht')).toBeInTheDocument();
    expect(screen.getByText('Modelle')).toBeInTheDocument();
  });

  it('calls onTabChange with "overview" when Übersicht is clicked', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="models"
        onTabChange={handleTabChange}
      />
    );

    const uebersichtTab = screen.getByText('Übersicht');
    fireEvent.click(uebersichtTab);

    expect(handleTabChange).toHaveBeenCalledWith('overview');
  });

  it('calls onTabChange with "models" when Modelle is clicked', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const modelleTab = screen.getByText('Modelle');
    fireEvent.click(modelleTab);

    expect(handleTabChange).toHaveBeenCalledWith('models');
  });

  it('highlights the active tab', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const uebersichtTab = screen.getByText('Übersicht').closest('button');
    expect(uebersichtTab).toHaveClass('text-gray-900', 'border-b-2', 'border-gray-900');
  });

  it('shows inactive tab styling for non-active tabs', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const modelleTab = screen.getByText('Modelle').closest('button');
    expect(modelleTab).toHaveClass('text-gray-600');
    expect(modelleTab).not.toHaveClass('border-b-2');
  });
});
